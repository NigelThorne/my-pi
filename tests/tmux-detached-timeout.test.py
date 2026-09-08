#!/usr/bin/env python3
"""Detached-helper regressions. All commands and windows are test doubles."""
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest


class DetachedTmuxTests(unittest.TestCase):
    def test_explicit_socket_works_without_inherited_tmux(self):
        self.run_fixture(hang=False)

    def test_stalled_ghostty_ipc_has_a_deadline(self):
        self.run_fixture(hang=True)

    def run_fixture(self, *, hang):
        with tempfile.TemporaryDirectory(prefix="pi-detached-test-") as directory:
            root = Path(directory)
            helper = root / "open-detached-tmux-sessions"
            source = (Path.home() / ".local/bin/open-detached-tmux-sessions").read_text()
            fake_osa = root / "osascript"
            # Keep production command selection unchanged; replace its executable
            # only in this private fixture copy.
            helper.write_text(source.replace("/usr/bin/osascript", str(fake_osa)))
            helper.chmod(0o755)
            attach = root / "ghostty-attach-tmux-session"
            attach.write_text("#!/bin/sh\nexit 0\n")
            attach.chmod(0o755)
            tmux = root / "tmux"
            tmux.write_text("#!/bin/sh\nprintf '$1\\tdetached-fixture\\t0\\n'\n")
            tmux.chmod(0o755)
            fake_osa.write_text("#!/bin/sh\nexec sleep 30\n" if hang else "#!/bin/sh\nexit 0\n")
            fake_osa.chmod(0o755)
            env = dict(os.environ, PI_TMUX_EXECUTABLE=str(tmux))
            env.pop("TMUX", None)
            args = [str(helper), "--socket", str(root / "socket")]
            if not hang:
                args.append("--dry-run")
            started = time.monotonic()
            process = subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
            try:
                stdout, stderr = process.communicate(timeout=7)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                process.communicate(timeout=2)
                self.fail("Ghostty IPC exceeded its 5-second bound")
            if hang:
                self.assertNotEqual(process.returncode, 0)
                self.assertLess(time.monotonic() - started, 6.5)
            else:
                self.assertEqual(process.returncode, 0, stderr)
                self.assertIn("detached-fixture", stdout)


if __name__ == "__main__":
    unittest.main()
