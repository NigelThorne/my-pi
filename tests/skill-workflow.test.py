"""Skill safety contracts. Static guards plus synthetic, non-secret shell checks.

These do not prove model compliance. Pair changes with scenario evaluation of
micro work, approved plans, active worktrees, credentials and high-risk review.
Run: python3 tests/skill-workflow.test.py
"""
from pathlib import Path
import os
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills/superpowers"
CHANGED = (
    "using-superpowers", "brainstorming", "writing-plans", "executing-plans",
    "branch-driven-development", "finishing-a-development-branch",
    "using-git-worktrees", "systematic-debugging", "test-driven-development",
    "writing-skills",
)


def skill(name):
    return (SKILLS / name / "SKILL.md").read_text()


class WorkflowContracts(unittest.TestCase):
    def test_frontmatter_and_pi_tool_names(self):
        for name in CHANGED:
            with self.subTest(skill=name):
                text = skill(name)
                self.assertTrue(text.startswith(f"---\nname: {name}\n"))
                desc = re.search(r"^description: (.+)$", text, re.M)
                self.assertIsNotNone(desc)
                self.assertLessEqual(len(desc.group(1)), 1024)
                for obsolete in ("TodoWrite", "Call the Skill tool", "superpowers:", "For Claude:"):
                    self.assertNotIn(obsolete, text)

    def test_activation_is_proportional(self):
        text = skill("using-superpowers")
        self.assertNotIn("1%", text)
        self.assertNotIn("before ANY response", text)
        self.assertIn("AGENTS.md", text)
        self.assertIn("Micro", text)
        self.assertIn("High risk", text)

    def test_plans_do_not_force_execution_method(self):
        text = skill("writing-plans")
        self.assertNotIn("Complete code in plan", text)
        self.assertNotIn("proceed directly with **subagent-driven development**", text)
        self.assertIn("write_artifact", text)
        self.assertIn("plan only", text)
        self.assertIn("worktree", text)

    def test_alternative_workflows_are_explicit_only(self):
        for name in ("executing-plans", "branch-driven-development"):
            with self.subTest(skill=name):
                text = skill(name)
                self.assertIn("disable-model-invocation: true", text.split("---")[1])
                self.assertNotIn("Default: First 3 tasks", text)
                self.assertNotIn("two-stage review", text)
                self.assertNotIn("Final review of entire implementation", text)
                self.assertIn("requesting-code-review", text)

    def test_design_notes_use_artifacts(self):
        text = skill("brainstorming")
        self.assertIn("write_artifact", text)
        self.assertNotIn("Commit the design document", text)
        self.assertNotIn("200-300 words", text)

    def test_finishing_preserves_active_worktrees(self):
        text = skill("finishing-a-development-branch")
        self.assertNotIn("Present exactly these 4 options", text)
        self.assertNotIn("**For Options 1, 2, 4:**", text)
        self.assertIn("Preserve the worktree", text)
        for safety in ("ignored", "untracked", "active", "unmerged", "approval", "Draft"):
            self.assertIn(safety, text)
        self.assertNotIn("git branch -D", text)

    def test_worktree_isolation(self):
        text = skill("using-git-worktrees")
        for unsafe in ("ln -s", "cp -p", "git checkout", "git reset", "patientnotes-dev-manager"):
            self.assertNotIn(unsafe, text)
        for safety in ("lockfile", "node_modules", "envFiles", "worktree", "primary", "baseline"):
            self.assertIn(safety, text)
        self.assertIn("exact", text)
        self.assertIn("stack-manager", text)

    def test_late_tests_preserve_work(self):
        text = skill("test-driven-development")
        for destructive in ("Delete it. Start over", "Delete code. Start over", "Delete means delete"):
            self.assertNotIn(destructive, text)
        self.assertIn("Preserve", text)
        self.assertIn("Refactor", text)
        self.assertIn("failing", text)

    def test_authoring_supports_explicit_invocation_and_evaluation(self):
        text = skill("writing-skills")
        self.assertNotIn("Only two fields supported", text)
        self.assertNotIn("Delete means delete", text)
        for requirement in ("disable-model-invocation", "baseline", "scenario", "write_artifact"):
            self.assertIn(requirement, text)

    def test_debugging_presence_example_never_discloses_values(self):
        text = skill("systematic-debugging")
        self.assertNotIn("env | grep", text)
        self.assertNotIn("${IDENTITY:-UNSET}", text)
        # Execute only the designated presence snippet, never the broader example.
        match = re.search(r"```bash\n(# Credential presence only[^`]+)```", text)
        self.assertIsNotNone(match, "Provide an isolated runnable presence example")
        script = match.group(1)
        for value, expected in ((None, "UNSET"), ("", "UNSET"), ("SYNTHETIC-AUDIT-SENTINEL", "SET")):
            with self.subTest(value=value):
                env = {"PATH": os.defpath}
                if value is not None:
                    env["IDENTITY"] = value
                result = subprocess.run(["/bin/bash", "-c", script], env=env,
                                        capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), f"IDENTITY: {expected}")
                self.assertNotIn("SYNTHETIC-AUDIT-SENTINEL", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
