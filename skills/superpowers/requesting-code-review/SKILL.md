---
name: requesting-code-review
description: Use when an independent review would materially reduce the risk of a completed code change
---

# Requesting code review

Use review proportionately. Tests and verification establish behavior. Review catches risks those checks do not cover. It is not a search for endless improvements.

## When to request review

- **Micro work:** do not request external review by default.
- **Standard work:** request one focused review only when the changed boundary, domain, or uncertainty makes it worthwhile.
- **High-risk work:** request one focused review after verification, with the relevant risks named in the prompt.

Before dispatching, provide the changed files or commit range, explicit acceptance criteria, and the narrow risk focus. Ask the reviewer for `Blocker`, `Follow-up`, and `Note` findings only.

## Triage

- Fix all Blockers before delivery. A Blocker is an introduced defect, a security or data-safety issue, or an unmet explicit requirement.
- Record Follow-ups and Notes without holding delivery.
- After fixing Blockers, request one targeted recheck of those findings only. Do not request a new broad review or a final approval review.

## Example

For a migration, ask the reviewer to check rollback, data preservation, and concurrency. If it finds an unsafe rollback, fix it and request a recheck of rollback behavior. Do not reopen style, naming, or unrelated architecture questions.

Do not invent requirements during review. New adjacent work is a Follow-up unless the diff introduces a release-blocking safety problem.
