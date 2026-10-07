---
name: using-superpowers
description: Use when choosing among overlapping skills or resolving skill workflow conflicts.
---

# Using skills in Pi

Use the smallest set of skills that materially helps the current task. Read a matching skill's `SKILL.md` with `read`; Pi has no separate Skill tool. Users can explicitly load one with `/skill:name`. Resolve bundled references relative to the skill directory.

Current user instructions and applicable `AGENTS.md` or `CLAUDE.md` rules govern the work. Follow their risk policy rather than accumulating every process a skill mentions.

- **Micro:** a contained change needs a focused check and diff inspection, not a planning pipeline.
- **Standard:** establish evidence, implement the agreed scope, and verify relevant behaviour. Delegate or review only when it adds value.
- **High risk:** name invariants and risks, verify them, and use a scoped independent review.

Brainstorm only when requested or when requirements need a real design decision. A clear implementation request does not need an interview. Planning does not automatically require worktrees, subagents, or another planning skill.

Alternative workflows marked `disable-model-invocation: true` are user-selected, not prerequisites to invoke automatically. Prefer direct execution when no special workflow is needed.

Keep task progress in Pi todo tools. Save session plans and notes with `write_artifact`, and retrieve them with `read_artifact`. Put durable project decisions in project documentation when that is the agreed outcome.
