---
name: writing-skills
description: Use when creating, editing, or evaluating agent skills.
---

# Writing skills for Pi

A skill is reusable task guidance, not another authority above current user instructions or repository policy. Keep one default for each discipline and avoid overlapping mandatory workflows.

## Establish the problem

Read the current skill, its referenced material, and applicable repository instructions. State the behaviour to improve and the invariants to preserve. Before editing, capture a baseline using representative task scenarios. For a mechanical defect, a failing deterministic check is appropriate evidence; do not invent a model failure.

Use `write_artifact` for session plans, evaluation notes, and worker reports. Keep durable skill files and regression tests in the owning repository.

## Write the skill

- Use portable `SKILL.md` frontmatter with `name` and a specific `description`. Pi supports `disable-model-invocation: true` for user-selected workflows.
- Make names lowercase with hyphens and keep descriptions within 1024 characters. Describe when the skill applies; avoid universal triggers unless genuinely required.
- In Pi, load a skill with `read`; users explicitly invoke it with `/skill:name`. Do not require unavailable tools.
- Write ordered steps with observable completion criteria. Separate reference material behind relative links when only some tasks need it.
- Preserve attribution and licensing when adapting another author's work.
- Refer to the current global and repository policies for risk, delegation, external changes, and workspace safety. Do not duplicate an incompatible policy.
- Resolve relative paths from the skill directory. Include referenced supporting files.
- For Pi-specific mechanics, read the installed Pi skills documentation instead of copying assumptions from another coding agent.

## Evaluate the change

1. Select focused scenarios covering the changed behaviour, an ordinary task that should not trigger it, and relevant safety boundaries. For process guidance, include realistic competing pressures such as urgency or existing work.
2. Record baseline decisions before editing. Distinguish a literal instruction conflict from observed agent behaviour.
3. Make the smallest coherent change. Preserve current work; do not discard it just because evaluation was added late.
4. Repeat the same scenarios against the revised skill. A bounded read-only evaluator can report decisions without executing destructive or external actions.
5. Run mechanical checks for frontmatter, links, obsolete tool names, and unsafe examples where useful. Execute shell examples only with synthetic inputs in isolation.
6. Inspect the diff. For security, cleanup, or other high-risk instructions, request one scoped independent review. Fix blockers and recheck affected findings, not endless broad review rounds.

Record which checks ran, what they establish, and remaining uncertainty. Static text checks do not prove model compliance. Shorter text alone is not evidence of better behaviour.

## Delivery

Keep local changes reviewable and preserve unrelated edits. Follow current approval and repository policy for commits, publication, and installation. Do not automatically push or publish a skill because its tests pass.

An existing Pi session may retain its startup catalogue or previously loaded text. Report when a reload or new session is needed; do not restart active sessions automatically.
