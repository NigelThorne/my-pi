---
name: patientnotes-stack-manager
description: Use when creating, starting, stopping, inspecting, or live-checking PatientNotes local development stacks, worktrees, components, ports, or local feature flags.
---

# PatientNotes Stack Manager

Use the installed `stack-manager` CLI for every PatientNotes local stack action. When the user says "spin up a stack", use Stack Manager. Do not use `patientnotes-dev-manager` or its `npm run cli` commands unless the user explicitly asks for that legacy tool.

## Start safely

Run from the PatientNotes workspace root:

```bash
command -v stack-manager
test -f /Users/nigelthorne/code/patientnotes/.stack-manager.config
stack-manager add /Users/nigelthorne/code/patientnotes --json
stack-manager list patientnotes --json
stack-manager discover patientnotes --json
```

`add` is safe to repeat. Inspect `list` and `discover` before creating or starting a stack.

## Create or start a complete stack

Every PatientNotes stack includes Firebase, Web, and Admin. Use the worktrees for the change:

```bash
stack-manager up patientnotes \
  --name <stack-name> \
  --components patientnotes-firebase,patientnotes-web,patientnotes-admin \
  --worktrees patientnotes-firebase=/Users/nigelthorne/code/patientnotes/patientnotes-firebase.worktrees/firebase-<branch-slug>,patientnotes-web=/Users/nigelthorne/code/patientnotes/patientnotes-web.worktrees/web-<branch-slug>,patientnotes-admin=/Users/nigelthorne/code/patientnotes/patientnotes-admin.worktrees/admin-<branch-slug> \
  --json
```

Omit `--worktrees` only when Stack Manager should create the declared worktrees. It starts dependencies first and configures Web and Admin to use that stack's local Firebase emulator.

Use `create` instead of `up` when the stack must be provisioned but left stopped.

```bash
stack-manager create patientnotes --name <stack-name> --components patientnotes-firebase,patientnotes-web,patientnotes-admin --json
```

## Health, URLs, and lifecycle

`status` returns recorded state. `health` performs a fresh probe. Always use `health` before reporting a stack as ready.

```bash
stack-manager health <stack-name> --json
stack-manager urls <stack-name> --json
stack-manager stop <stack-name> --json
stack-manager cleanup <stack-name> --json
```

Never run `cleanup` until the stack is stopped. It refuses changed worktrees and modified managed local files.

## Feature flags and handoff

Set the needed local feature flags with `--feature-flags` when creating or starting the stack. Before handing a stack to the user, report its name, each `127.0.0.1` URL from `urls`, enabled flags, and a short "What to test" list.
