#!/usr/bin/env python3
"""Exercise ordinary bootstrap and real presence publication on a reused server.

Only private tmux sessions and an inert Node publisher are started. Nothing
connects to the user's indexer or writes to the user's presence directory.
"""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time
import unittest

REPO = Path(__file__).resolve().parents[1]


class OrdinaryEnvironmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmux = shutil.which("tmux")
        cls.node = shutil.which("node")
        if not cls.tmux or not cls.node:
            raise unittest.SkipTest("tmux and node required")
        cls.temp = tempfile.TemporaryDirectory(prefix="pi-ordinary-env-", dir="/tmp")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.socket = str(cls.root / "tmux.sock")
        cls.addClassCleanup(lambda: subprocess.run(
            [cls.tmux, "-S", cls.socket, "kill-server"], capture_output=True, timeout=3))
        cls.probe = cls.root / "publisher.mjs"
        cls.probe.write_text("""
import { LiveSessionPresenceBridge } from MODULE;
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [root, label] = process.argv.slice(2);
const directory = join(root, 'presence-' + label);
const ctx = { cwd: process.cwd(), isIdle: () => true, sessionManager: {
  getSessionId: () => label, getSessionFile: () => join(root, label + '.jsonl'),
}};
const bridge = new LiveSessionPresenceBridge({directory, sendAdvisoryPoke: () => {}});
bridge.start(ctx);
const path = join(directory, encodeURIComponent(label) + '.json');
const started = JSON.parse(readFileSync(path, 'utf8'));
const result = bridge.registerWindow(ctx);
const registered = JSON.parse(readFileSync(path, 'utf8'));
bridge.stop(ctx);
const inherited = Object.fromEntries(['PI_GHOSTTY_HANDSHAKE_TOKEN', 'PI_GHOSTTY_TTY', 'GHOSTTY_SURFACE_ID'].map(key => [key, process.env[key]]));
writeFileSync(join(root, label + '.result'), JSON.stringify({started, registered, result, inherited}));
setInterval(() => {}, 1000);
""".replace("MODULE", json.dumps(str(REPO / "extensions/pi-session-manager-presence.ts"))))
        cls.expected = {}
        for number, label in enumerate(["first", "second"], 1):
            identity = {
                "PI_GHOSTTY_APP_PID": str(9000 + number),
                "PI_GHOSTTY_TTY": f"/dev/ttys90{number}",
                "PI_GHOSTTY_PARENT_TTY": f"/dev/ttys90{number}",
                "PI_GHOSTTY_WINDOW_ID": f"fixture-{label}-window",
                "PI_GHOSTTY_TERMINAL_ID": f"fixture-{label}-terminal",
                "GHOSTTY_SURFACE_ID": f"fixture-{label}-terminal",
                "PI_GHOSTTY_HANDSHAKE_TOKEN": f"00000000-0000-4000-8000-{number:012d}",
            }
            cls.expected[label] = identity
            cwd = cls.root / (label + " cwd with spaces")
            cwd.mkdir()
            env = dict(os.environ)
            for key in ["TMUX", "TMUX_PANE", "PI_GHOSTTY_TMUX_BOOTSTRAP_MODE", "PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE"]:
                env.pop(key, None)
            env.update(identity, TERM="dumb", PI_GHOSTTY_TMUX_EXECUTABLE=cls.tmux,
                       PI_GHOSTTY_TMUX_SOCKET_PATH=cls.socket, FIXTURE_CONFIG=str(REPO / "tmux.conf"),
                       FIXTURE_SESSION=label, FIXTURE_COMMAND=cls.command(label))
            script = '''source "$1"
_pi_ghostty_tmux_bootstrap_exec() {
  "$1" -f "$FIXTURE_CONFIG" "${@:2}" -d -s "$FIXTURE_SESSION" "$FIXTURE_COMMAND"
}
_pi_ghostty_tmux_start_ordinary
'''
            subprocess.run(["/bin/zsh", "-fc", script, "fixture", str(REPO / "shell/ghostty-tmux-bootstrap.zsh")],
                           env=env, cwd=cwd, check=True, capture_output=True, text=True, timeout=5)
            cls.result(label)
        for parent, operation in [("first", "split-window"), ("second", "split-window"), ("second", "new-window")]:
            label = parent + "-" + operation
            target = parent + (":" if operation == "new-window" else ":0")
            cls.cli(operation, "-d", "-t", target, cls.command(label))
            cls.result(label)

    @classmethod
    def command(cls, label):
        return shlex.join([cls.node, "--experimental-strip-types", str(cls.probe), str(cls.root), label])

    @classmethod
    def cli(cls, *args):
        return subprocess.check_output([cls.tmux, "-S", cls.socket, *args], text=True, timeout=3).strip()

    @classmethod
    def result(cls, label):
        path = cls.root / (label + ".result")
        end = time.monotonic() + 5
        while not path.exists() and time.monotonic() < end:
            time.sleep(.03)
        if not path.exists():
            raise AssertionError(f"Owned publisher did not report: {label}")
        return json.loads(path.read_text())

    def assert_publication(self, label, parent):
        result = self.result(label)
        self.assertTrue(result["result"]["ok"])
        identity = self.expected[parent]
        for key, value in result["inherited"].items():
            self.assertEqual(value, identity[key], f"{label} inherited {key}")
        self.assertEqual(set(result["inherited"]), {"PI_GHOSTTY_HANDSHAKE_TOKEN", "PI_GHOSTTY_TTY", "GHOSTTY_SURFACE_ID"})
        for stage in ["started", "registered"]:
            record = result[stage]
            for field, key in [("ghosttyAppPID", "PI_GHOSTTY_APP_PID"),
                               ("ghosttyWindowID", "PI_GHOSTTY_WINDOW_ID"),
                               ("ghosttyTerminalID", "PI_GHOSTTY_TERMINAL_ID"),
                               ("ghosttyParentTTY", "PI_GHOSTTY_PARENT_TTY")]:
                expected = int(identity[key]) if field == "ghosttyAppPID" else identity[key]
                self.assertEqual(record[field], expected, f"{label} {stage} {field}")
            route = record["tmux"]
            actual = self.cli("display-message", "-p", "-t", route["paneID"],
                              "#{pid}\t#{session_id}\t#{window_id}\t#{pane_id}").split("\t")
            self.assertEqual([str(route["serverPID"]), route["sessionID"], route["windowID"], route["paneID"]], actual)
            self.assertEqual(Path(route["socketPath"]).resolve(), Path(self.socket).resolve())
            self.assertEqual(self.cli("display-message", "-p", "-t", route["paneID"], "#{session_name}"), parent)

    def test_two_windows_publish_their_own_identity_on_start_and_register(self):
        self.assert_publication("first", "first")
        self.assert_publication("second", "second")

    def test_child_panes_and_windows_inherit_their_session_not_the_server(self):
        self.assert_publication("first-split-window", "first")
        self.assert_publication("second-split-window", "second")
        self.assert_publication("second-new-window", "second")

    def test_second_session_does_not_overwrite_global_server_identity(self):
        self.assertEqual(self.cli("show-environment", "-g", "PI_GHOSTTY_WINDOW_ID"),
                         "PI_GHOSTTY_WINDOW_ID=fixture-first-window")


if __name__ == "__main__":
    unittest.main()
