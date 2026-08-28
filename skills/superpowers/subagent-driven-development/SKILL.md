---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session
---

# Subagent-driven development

Use fresh workers when delegation saves time. Follow the project's proportional quality-gates policy. Evidence-based verification is required. Repeated broad reviews are not.

## Choose the gate first

| Change | Required gate |
| --- | --- |
| Micro, contained, non-risky | Focused verification and a self-check of the diff. No external reviewer by default. |
| Standard behavior change | Focused tests and, only when an independent check adds value, one release-blocker review of the completed diff. |
| High risk: security, data, persistence, concurrency, process ownership, external or production integration, broad refactor | Identify risks and acceptance criteria before coding. Run focused verification and one scoped risk review. |

## Workflow

1. State the acceptance criteria and risk tier before implementation.
2. Give the worker the full task context and exact verification command. Use test-driven development for behavior changes.
3. Run the relevant tests, lint, build, or manual check. Inspect the actual diff.
4. When the gate calls for review, dispatch one reviewer with the changed files, acceptance criteria, and specific risk focus. Ask for Blockers, Follow-ups, and Notes only.
5. Fix all Blockers together. Recheck only those findings and regressions from the fixes. Do not send the whole change through another broad review.
6. Deliver when acceptance criteria and verification pass. Follow-ups do not block delivery.

## Example

A README typo is micro work: edit, inspect the diff, and deliver. A parser bug is standard work: add a regression test, fix it, run focused tests, then use one review only if the parser boundary warrants it. A process-cleanup change is high risk: decide ownership and failure behavior before coding, test them, then request one review focused on that risk.

## Never

- Require a planner, scout, or reviewer for micro work.
- Treat nits, preferences, or newly discovered adjacent work as blockers.
- Require both spec and quality reviews for every task.
- Re-review a fix broadly or require a final reviewer after a targeted recheck.
- Reopen completed work because of a later user-requested delta unless the delta changes the risk tier.
