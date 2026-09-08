#!/usr/bin/env python3
"""Final cutover checks. Never print shell contents, which may contain secrets."""
import os
from pathlib import Path
import re
import subprocess
import unittest


class ZshrcTmuxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = Path(os.environ.get("PI_TEST_ZSHRC", str(Path.home() / ".zshrc")))
        cls.source = cls.path.read_text()
        cls.lines = [line.strip() for line in cls.source.splitlines() if not line.lstrip().startswith("#")]

    def test_shell_syntax(self):
        result = subprocess.run(["/bin/zsh", "-n", str(self.path)], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, "zsh -n failed; inspect syntax locally without dumping shell credentials")

    def test_new_ghostty_startup_uses_tmux_bootstrap(self):
        self.assertTrue(any('source "$HOME/.my-pi/shell/ghostty-tmux-bootstrap.zsh"' in line for line in self.lines), "New Ghostty startup must source the tested additive tmux bootstrap")

    def test_mux_backend_not_globally_forced(self):
        self.assertFalse(any(re.match(r"(?:export\s+)?PI_SUBAGENT_MUX=", line) for line in self.lines), "Preserved Zellij sessions must retain runtime mux detection")

    def test_original_zellij_helpers_retained(self):
        for declaration in (
            'function zr () { zellij run --name "$*" -- zsh -ic "$*";}',
            'function zrf () { zellij run --name "$*" --floating -- zsh -ic "$*";}',
            'function zri () { zellij run --name "$*" --in-place -- zsh -ic "$*";}',
            'function ze () { zellij edit "$*";}',
            'function zef () { zellij edit --floating "$*";}',
            'function zei () { zellij edit --in-place "$*";}',
        ):
            self.assertTrue(declaration in self.source, "An original Zellij helper was changed or removed")

    def test_additive_tiled_helpers_loaded(self):
        self.assertTrue(any('source "$HOME/.my-pi/shell/tmux-helpers.zsh"' in line for line in self.lines), "Load the separately named tmux tiled helpers")

    def test_connected_hook_not_zellij_only(self):
        hooks = [line for line in self.lines if line.startswith("export MYCELIUM_CONNECTED_COMMAND=")]
        self.assertEqual(len(hooks), 1, "Expected one connected hook")
        self.assertFalse("='zellij action rename-pane" in hooks[0], "Connected hook must select the current mux")


if __name__ == "__main__":
    unittest.main()
