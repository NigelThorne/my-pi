---
name: stack-manager
description: Use when creating, starting, stopping, inspecting, or cleaning up configuration-driven local development stacks, Git worktrees, component dependencies, ports, or live health with the stack-manager CLI or dashboard.
---

# Using Stack Manager

Stack Manager is the generic local stack runner. It is not PatientNotes Dev Manager and has no backend presets or product-specific flags.

## Start safely

1. Confirm the binary and config root:
   ```bash
   command -v stack-manager
   test -f <workspace>/.stack-manager.config
   stack-manager add <workspace> --json
   ```
   `add` is safe to repeat. The config defines components, commands, worktrees, ports, local env files, URLs, dependencies, and readiness checks.
2. Inspect before mutating:
   ```bash
   stack-manager list <project> --json
   stack-manager discover <project> --json
   ```
3. Create or start a named stack. Use `create` to provision it stopped; use `up` to create then start it:
   ```bash
   stack-manager up <project> --name <stack-name> --components <component> --json
   ```
   Component selection includes transitive `dependsOn` entries. Dependencies start and pass readiness before their dependents start.

## Health and lifecycle

`status` returns recorded lifecycle state. `health` performs a fresh process/HTTP probe and records bounded component readiness history:

```bash
stack-manager health <stack-name> --json
stack-manager urls <stack-name> --json
stack-manager stop <stack-name> --json
```

A component config can use process readiness or an HTTP endpoint, including a Firebase Emulator Hub endpoint:

```js
readiness: { kind: 'http', port: 'firebase-hub', path: '/emulators', timeoutMs: 120_000 }
```

The loopback dashboard exposes the same live health action. Check its configured URL, do not assume a port.

## Worktrees, secrets, and cleanup

- New stacks create declared Git worktrees. Use `--worktrees component=/path` only for a discovered existing Git worktree.
- Do not put secrets in `env`; declare private local files under `envFiles.copy`. Never print their contents.
- Do not run `cleanup` unless the stack is stopped. It refuses changed worktrees, modified managed local files, or unmerged branches.
- This is local tooling. Do not substitute product-specific `--backend`, cloud, emulator, or deployment flags; inspect `stack-manager <command> --help` when unsure.
