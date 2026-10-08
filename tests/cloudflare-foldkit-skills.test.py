"""Static safety contracts from the Little wins trial, not proof of model compliance.

Pair these checks with read-only scenario evaluation of approval, socket lifecycle
and partial deletion. No deploy, browser, credential or deletion commands run here.
Run: python3 tests/cloudflare-foldkit-skills.test.py
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
NAMES = ("alchemy", "foldkit", "stack-manager")


def document(name, file="SKILL.md"):
    return (ROOT / "skills" / name / file).read_text()


class TrialSkillContracts(unittest.TestCase):
    def test_discovery_and_local_reference_links(self):
        for name in NAMES:
            with self.subTest(skill=name):
                text = document(name)
                self.assertTrue(text.startswith(f"---\nname: {name}\n"))
                desc = re.search(r"^description: (.+)$", text, re.M)
                self.assertIsNotNone(desc)
                self.assertLessEqual(len(desc.group(1)), 1024)
                for file in ("SKILL.md", "reference.md"):
                    body = document(name, file)
                    self.assertEqual(len(re.findall(r"^```", body, re.M)) % 2, 0)
                    for link in re.findall(r"\]\(([^)]+)\)", body):
                        if not re.match(r"(?:https?://|#)", link):
                            self.assertTrue((ROOT / "skills" / name / link.split("#")[0]).exists(), link)

    def test_resources_follow_app_needs_not_a_tutorial(self):
        text = document("alchemy")
        self.assertNotIn("start with the bucket-only", text)
        for term in ("smallest", "R2", "localState()", "Cloudflare.state()"):
            self.assertIn(term, text)

    def test_noninteractive_flag_preserves_current_approval_gate(self):
        text = document("alchemy")
        for term in ("--yes", "current explicit approval", "unchanged", "not permission"):
            self.assertIn(term, text)

    def test_bootstrap_and_local_emulation_remain_distinct(self):
        text = document("alchemy") + document("alchemy", "reference.md")
        for term in ("bootstrap", "Alchemy.remote()", "Miniflare", "credentials", "local-only"):
            self.assertIn(term, text)

    def test_login_workaround_is_versioned_and_not_authorization(self):
        text = document("alchemy", "reference.md")
        for term in ("2.0.0-beta.81", "ALCHEMY_TUI=1", "NonInteractiveTerminal", "SubdomainNotFound", "approval"):
            self.assertIn(term, text)

    def test_persistent_resource_rollback_is_explicit(self):
        text = document("alchemy") + document("alchemy", "reference.md")
        for term in ("class", "binding", "migration", "rollback", "session data"):
            self.assertIn(term, text)

    def test_foldkit_state_and_lifecycle_guidance(self):
        text = document("foldkit") + document("foldkit", "reference.md")
        for term in ("tagged", "Effect.callback", "interruption", "normal completion", "HTTP", "Offline", "late"):
            self.assertIn(term, text)

    def test_examples_are_pinned_and_do_not_claim_ssr_proof(self):
        for name in ("alchemy", "foldkit"):
            with self.subTest(skill=name):
                text = document(name, "reference.md")
                self.assertIn("b9ce57972e47f8378985c8818a2bf20d2111fef9", text)
                self.assertIn("not", text)
                self.assertIn("SSR", text)
                self.assertIn("SSG", text)

    def test_stack_deletion_requires_step_and_resource_verification(self):
        text = document("stack-manager") + document("stack-manager", "reference.md")
        for term in ("delete-action", "failed", "skipped", "completed", "ignored", "unmerged", "registration", "absence"):
            self.assertIn(term, text)

    def test_timeout_is_not_a_force_delete_recipe(self):
        text = document("stack-manager", "reference.md")
        for term in ("10-second", "partial", "new approval", "tool defect"):
            self.assertIn(term, text)
        self.assertNotIn("rm -rf", text)
        self.assertNotIn("git branch -D", text)


if __name__ == "__main__":
    unittest.main()
