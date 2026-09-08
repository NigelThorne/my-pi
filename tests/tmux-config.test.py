#!/usr/bin/env python3
"""Check managed tmux settings on a disposable, explicitly named server."""
import fcntl
import os
from pathlib import Path
import pty
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time
import unittest
import uuid


class TmuxConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmux = os.environ.get("TMUX_TEST_EXECUTABLE") or shutil.which("tmux")
        if not cls.tmux:
            raise unittest.SkipTest("tmux is not installed")
        cls.server = "pi-config-test-" + uuid.uuid4().hex
        cls.config = os.environ.get("TMUX_TEST_CONFIG", str(Path(__file__).resolve().parents[1] / "tmux.conf"))
        cls.run_tmux("-f", cls.config, "new-session", "-d", "-s", "config", "-x", "100", "-y", "30")

    @classmethod
    def run_tmux(cls, *args):
        env = dict(os.environ)
        env.pop("TMUX", None)
        env.pop("TMUX_PANE", None)
        return subprocess.check_output([cls.tmux, "-L", cls.server, *args], env=env, text=True, timeout=5).strip()

    @classmethod
    def tearDownClass(cls):
        cls.run_tmux("kill-server")

    def test_mouse_and_history(self):
        self.assertEqual(self.run_tmux("show-options", "-gv", "mouse"), "on")
        self.assertEqual(self.run_tmux("show-options", "-gv", "history-limit"), "10000")

    def test_modified_enter_protocol(self):
        self.assertEqual(self.run_tmux("show-options", "-sv", "extended-keys"), "on")
        self.assertEqual(self.run_tmux("show-options", "-sv", "extended-keys-format"), "csi-u")

    def test_titles_and_both_mouse_release_tables(self):
        self.assertEqual(self.run_tmux("show-options", "-gv", "pane-border-status"), "top")
        self.assertEqual(self.run_tmux("show-options", "-gv", "pane-border-format"), "#{pane_title}")
        for table in ("copy-mode", "copy-mode-vi"):
            binding = self.run_tmux("list-keys", "-T", table, "MouseDragEnd1Pane")
            self.assertIn("copy-pipe-and-cancel", binding)
            self.assertIn("pbcopy", binding)

    def test_mouse_release_copies_and_modified_enter_reaches_application(self):
        # A PTY represents the terminal client. Capture the configured pbcopy
        # command without replacing the user's clipboard during automated tests.
        for mode in ("emacs", "vi"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(prefix="pi-tmux-input-") as directory:
                root = Path(directory)
                server = "pi-input-test-" + uuid.uuid4().hex
                env = dict(os.environ)
                env.pop("TMUX", None)
                env.pop("TMUX_PANE", None)
                env.update(TERM="xterm-256color", PATH=f"{root}:{env['PATH']}", PI_TEST_COPY_PATH=str(root / "copied"))
                copier = root / "pbcopy"
                copier.write_text('#!/bin/sh\n/bin/cat > "$PI_TEST_COPY_PATH"\n')
                copier.chmod(0o755)
                program = (
                    "import os,tty,sys,time; tty.setraw(0); "
                    "print('tmux-drag-probe',flush=True); "
                    "sys.stdout.write('\\033[>4;2m'); sys.stdout.flush(); "
                    f"data=os.read(0,100); open({str(root / 'keys')!r},'wb').write(data); time.sleep(20)"
                )

                def command(*args):
                    return subprocess.check_output([self.tmux, "-L", server, *args], env=env, text=True, timeout=5)

                def await_file(path):
                    deadline = time.monotonic() + 3
                    while time.monotonic() < deadline:
                        if path.exists():
                            content = path.read_bytes()
                            if content:
                                return content
                        time.sleep(0.02)
                    self.fail(f"Timed out waiting for {path.name} content")

                master, slave = pty.openpty()
                fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
                client = None
                started = False
                try:
                    command("-f", self.config, "new-session", "-d", "-s", "input", "-x", "100", "-y", "30", "python3", "-u", "-c", program)
                    started = True
                    command("set-window-option", "mode-keys", mode)
                    command("set-option", "-as", "terminal-features", ",xterm-256color:extkeys")
                    client = subprocess.Popen([self.tmux, "-L", server, "attach-session", "-t", "input"], stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
                    output = b""
                    deadline = time.monotonic() + 5
                    while b"tmux-drag-probe" not in output and time.monotonic() < deadline:
                        if select.select([master], [], [], 0.1)[0]:
                            output += os.read(master, 65536)
                    self.assertIn(b"tmux-drag-probe", output)
                    # Pane-border occupies row 1. Drag across text on row 2.
                    for sequence in (b"\x1b[<0;1;2M", b"\x1b[<32;16;2M", b"\x1b[<0;16;2m"):
                        os.write(master, sequence)
                        time.sleep(0.08)
                    self.assertEqual(await_file(root / "copied").rstrip(b"\n"), b"tmux-drag-probe")
                    modified_enter = b"\x1b[13;2u" if mode == "emacs" else b"\x1b[13;5u"
                    os.write(master, modified_enter)
                    self.assertEqual(await_file(root / "keys"), modified_enter)
                finally:
                    if started:
                        command("kill-server")
                    if client:
                        client.wait(timeout=3)
                    os.close(master)
                    os.close(slave)


if __name__ == "__main__":
    unittest.main()
