#!/usr/bin/env python3
"""Check ordinary-window versus managed-request handshake token inheritance."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class GhosttyTmuxContextTests(unittest.TestCase):
    def probe(self, backend=None):
        with tempfile.TemporaryDirectory(prefix="pi-context-token-") as directory:
            context = Path(directory) / "context.zsh"
            context.write_text('print -r -- "${PI_GHOSTTY_HANDSHAKE_TOKEN-unset}"\n')
            env = dict(os.environ)
            env.pop("PI_GHOSTTY_TMUX_BOOTSTRAP_MODE", None)
            env.pop("PI_GHOSTTY_ZELLIJ_BOOTSTRAP_MODE", None)
            env.update(TERM="dumb", PI_GHOSTTY_CONTEXT_SCRIPT=str(context),
                       PI_GHOSTTY_HANDSHAKE_TOKEN="AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")
            if backend:
                env[f"PI_GHOSTTY_{backend}_BOOTSTRAP_MODE"] = "managed"
            helper = Path(__file__).resolve().parents[1] / "shell/ghostty-tmux-bootstrap.zsh"
            result = subprocess.run(["/bin/zsh", "-fc", 'source "$1"; _pi_ghostty_tmux_bootstrap_context',
                                     "test", str(helper)], env=env, capture_output=True, text=True, timeout=4)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout.strip()

    def test_ordinary_windows_do_not_reuse_an_inherited_route_token(self):
        self.assertEqual(self.probe(), "unset")

    def test_managed_tmux_request_keeps_its_claim_once_token(self):
        self.assertEqual(self.probe("TMUX"), "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")

    def test_managed_zellij_request_keeps_its_claim_once_token(self):
        self.assertEqual(self.probe("ZELLIJ"), "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")


if __name__ == "__main__":
    unittest.main()
