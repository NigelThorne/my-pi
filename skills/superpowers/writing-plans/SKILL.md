---
name: writing-plans
description: Use when an agreed change needs a multi-step implementation plan, or the user explicitly asks for a plan.
---

# Writing plans

Start with the outcome, acceptance criteria, known evidence, risks, and unresolved decisions. Follow the current user request and the repository's risk and delivery policy.

A plan should make execution clear without writing the implementation twice.

## Plan shape

- Goal and scope, including what stays unchanged.
- Constraints, affected interfaces, and important file paths.
- Ordered tasks and genuine dependencies. Each task should produce a verifiable result.
- Relevant test, lint, build, or behaviour checks, including expected outcomes.
- Rollback or recovery for high-risk work.
- Decisions or access still needed.

Include code snippets only when they settle an ambiguity. Verify paths and commands against the repository; leave uncertain details explicit rather than inventing them.

Use `write_artifact` for the working plan and report its name. Use project docs instead only when the requested deliverable is a durable project plan. Track multi-step execution with Pi todo tools.

## Execution

For a request for a plan only, stop after delivering the plan. For an already approved implementation, proceed with the smallest suitable execution method. Ask only about unresolved decisions, not for repeated approval of settled work.

A worktree is useful when isolation is needed and the repository permits it. Subagents are useful for bounded independent work. Neither is required merely because a plan exists.

For review gates, read the available `requesting-code-review` skill when its trigger applies. Keep verification evidence tied to acceptance criteria.
