"""Visual PR skill registration, attribution and safety contract; no live services."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "skills/pr"


class PrSkillTests(unittest.TestCase):
    def text(self):
        self.assertTrue((DIR / "SKILL.md").is_file())
        return (DIR / "SKILL.md").read_text()

    def test_discoverable_trigger_and_visual_formats(self):
        text = self.text()
        self.assertTrue(text.startswith("---\nname: pr\n"))
        frontmatter = text.split("---")[1]
        self.assertNotIn("disable-model-invocation: true", frontmatter)
        self.assertRegex(frontmatter, r"description:.*PR")
        for item in ("```mermaid", "```diff", "## Summary", "## Evidence", "## Merge Danger"):
            self.assertIn(item, text)
        self.assertIn("smallest view", text)

    def test_attribution_and_license(self):
        text = self.text()
        for item in ("Matt Pocock", "Dex Horthy", "Humanlayer", "show-me", "6fd9479"):
            self.assertIn(item, text)
        license_text = (DIR / "LICENSE").read_text()
        self.assertIn("MIT License", license_text)
        self.assertIn("Copyright (c) 2026 Matt Pocock", license_text)
        self.assertIn("THE SOFTWARE IS PROVIDED", license_text)

    def test_drafting_does_not_authorise_side_effects(self):
        text = self.text()
        for item in ("approval", "desktop", "screenshots", "Never invent", "template", "unavailable"):
            self.assertIn(item, text)
        self.assertNotIn("Call the Skill tool", text)

    def test_markdown_fences_are_balanced(self):
        fences = re.findall(r"^```.*$", self.text(), re.M)
        self.assertEqual(len(fences) % 2, 0)


if __name__ == "__main__":
    unittest.main()
