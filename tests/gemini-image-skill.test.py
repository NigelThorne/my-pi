"""Registration and safety contract for the Gemini image skill, no live services."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/gemini-image/SKILL.md"


class GeminiImageSkillTests(unittest.TestCase):
    def skill(self):
        self.assertTrue(SKILL.is_file(), "Image requests need a discoverable Gemini skill")
        return SKILL.read_text()

    def test_discoverable_image_generation_trigger(self):
        text = self.skill()
        self.assertTrue(text.startswith("---\nname: gemini-image\n"))
        description = re.search(r"^description: (.+)$", text, re.MULTILINE)
        self.assertIsNotNone(description)
        self.assertLessEqual(len(description.group(1)), 1024)
        self.assertTrue(description.group(1).startswith("Use when"))
        self.assertIn("image", description.group(1))
        self.assertLess(len(text.split()), 650)

    def test_generation_example_and_viewing(self):
        text = self.skill()
        for fragment in ("scripts/gemini-image", "generate", "--prompt", "--output", "--aspect-ratio", "`read`", "PNG"):
            self.assertIn(fragment, text)
        self.assertIn("existing", text)

    def test_expired_auth_requires_explicit_browser_permission(self):
        text = self.skill()
        for fragment in ("Keychain", "auth --target", "--account", "permission", "expired", "Do not", "quota"):
            self.assertIn(fragment, text)
        self.assertIn("logout", text)
        self.assertIn("No paid API fallback", text)

    def test_old_extension_is_disabled_but_recoverable(self):
        self.assertFalse((ROOT / "extensions/antigravity-image-gen.ts").exists())
        self.assertTrue((ROOT / "disabled/antigravity-image-gen.ts").is_file())

    def test_global_guidance_points_to_replacement(self):
        guidance = (ROOT / "AGENTS.md").read_text()
        self.assertIn("gemini-image", guidance)
        self.assertNotIn("Requires `/login` for google-antigravity", guidance)


if __name__ == "__main__":
    unittest.main()
