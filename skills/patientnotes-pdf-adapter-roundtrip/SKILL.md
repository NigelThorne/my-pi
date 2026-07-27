---
name: patientnotes-pdf-adapter-roundtrip
description: Use when asked to turn a PDF form into a PatientNotes PDF adapter ZIP, correct or complete an existing PDF adapter form, validate questions or placements, roundtrip a PDF through questions/answers/population, inspect AcroForm coverage, or produce questions.json/placements.json/export bundles for PDF forms.
---

# PatientNotes PDF Adapter Roundtrip

## Principle
Own the artifact loop directly. Do not rely on the coach for correctness. Use the PDF pipeline API/files, inspect every generated artifact, edit JSON yourself when needed, and only call the ZIP complete after a populated PDF proves the mapping.

## Inputs Needed
- Source PDF.
- Any known expectations: required question flow, wording preferences, row/multi-choice semantics, fields that must be included or ignored.
- Acceptance from the user for ambiguous clinical/business interpretation.

## Existing Project Takeover
Use this when the user gives an existing form/project that is partially complete, wrong, or stuck.

1. **Load current state first**
   - Identify the project id/form URL or artifact folder.
   - Download current `source.pdf`, `questions.json`, `placements.json`, `answers.json` if present.
   - Fetch AcroForm fields and current diagnostics/coverage.
   - Do not regenerate anything until you know what is already correct.

2. **Audit before editing**
   - Compare questions to the PDF and AcroForm fields.
   - Identify missing, duplicate, stale, over-split, or mis-modelled questions.
   - Identify missing, stale, duplicate, wrong-strategy, or misaligned placements.
   - Record what can be fixed deterministically and what needs user judgement.

3. **Preserve good work**
   - Keep stable question ids unless changing them is required.
   - Preserve correct placements when editing `placements.json`.
   - Prefer targeted JSON edits over full regeneration.
   - If regeneration is needed, first save/inspect the existing artifact so useful mappings/questions can be restored.

4. **Drive to done**
   - Fix questions and placements directly.
   - Run fake-answer population.
   - Review the populated PDF.
   - Iterate until the same completion criteria below are met.
   - Export the final ZIP and report exactly what changed.

## Direct Workflow
Run from an admin worktree or local admin dev server.

1. **Create project from PDF**
   - Upload/create via `/api/pdf-pipeline/projects`.
   - Confirm `source.pdf` is retrievable and the project has the expected PDF name.

2. **Inspect PDF structure before generation**
   - Fetch AcroForm fields: `/api/pdf-pipeline/projects/:id/acro-fields`.
   - Note fields, pages, checkbox/radio groups, repeated row structures, and any non-Acro visual-only response areas.

3. **Generate questions**
   - Call `/generate-questions`.
   - Download `questions.json`.
   - Review against the PDF and AcroForm fields:
     - every meaningful field has a question or is intentionally ignored
     - repeated row fields are modelled coherently
     - multi-choice fields are one question with choices, not one question per checkbox/radio
     - dependencies/nested questions match the visual and logical flow
     - IDs are stable snake_case and suitable for placements
   - Edit and replace `questions.json` directly if generation is wrong.

4. **Generate placements**
   - Call `/generate-placements` or use rectangle/iterative placement endpoints when no AcroForm fields exist.
   - Download `placements.json`.
   - Review:
     - uses `strategy: "acroform"` when AcroForm fields exist and match
     - uses overlays only for visual-only fields or where AcroForm cannot represent the answer
     - each placement references an existing question id
     - each choice placement maps options under one placement
     - text/date/signature placements use the correct field, bounds, and formatting
   - Edit and replace `placements.json` directly if needed. Preserve unrelated placements when making targeted fixes.

5. **Generate test answers and populate**
   - Call `/generate-fake-answers`.
   - Edit `answers.json` to exercise edge cases: long text, selected choices, dates, rows, conditional branches.
   - Call `/populate-pdf`.
   - Review the populated PDF visually:
     - answers appear in the expected locations
     - AcroForm fields are filled when present
     - checkboxes/radios/multi-choice marks align
     - long text/date formatting fits
     - no answer appears in the wrong field

6. **Iterate**
   - If questions are wrong, fix `questions.json`, then reassess placements.
   - If mappings are wrong, fix `placements.json`, regenerate/populate, and review again.
   - Keep looping until diagnostics and populated PDF review are acceptable.

7. **Export ZIP**
   - Fetch `/patientnotes-export.zip` only after required artifacts are final.
   - Confirm ZIP contains source PDF, `questions.json`, and `placements.json`.

## Completion Criteria
Do not claim completion until all are true:

- Source PDF is present and retrievable.
- `questions.json` parses and matches the expected schema.
- `placements.json` parses and matches `PdfDescription`.
- No placement references a missing question id.
- Every required AcroForm field or visual response area is either mapped or explicitly documented as ignored.
- Multi-choice/checkbox/radio groups are represented as one question with choices where semantically appropriate.
- Generated/edited `answers.json` populates the PDF successfully.
- Populated PDF has been reviewed visually and obvious alignment/field errors are fixed.
- Export ZIP downloads and contains the expected final files.
- Verification commands/results and any remaining ambiguities are reported to the user.

## Common Mistakes
- Trusting generated questions without comparing them to the PDF.
- Treating every checkbox as a separate question instead of modelling a choice group.
- Replacing `placements.json` for one fix without preserving unrelated mappings.
- Using overlay placements when AcroForm fields are available and correct.
- Exporting before running a populated PDF test.
- Calling an ambiguous business decision “correct” without user confirmation.
