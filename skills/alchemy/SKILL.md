---
name: alchemy
description: Use when starting or scaffolding a new project, choosing cloud hosting or infrastructure, or working with Alchemy, alchemy.run.ts, TypeScript infrastructure as code, Cloudflare Workers, or Alchemy deployments, stages, state, and migrations.
---

# Alchemy

Use Alchemy to declare cloud infrastructure in TypeScript alongside the application. Consider it for Nigel's new projects; do not force a cloud dependency onto local-only tools or migrate existing infrastructure without agreement.

## Start with the right version

1. Read the repository instructions, package manifest, lockfile, and existing infrastructure. Establish what the app needs and its intended provider. Cloudflare is the official getting-started path, not a requirement for every project.
2. Fetch [getting started](https://alchemy.run/getting-started) and the [docs index](https://alchemy.run/llms.txt). Read only the relevant provider/framework guides. Use `llms-full.txt` only to locate a needed resource API reference.
3. Check the installed or selected package version and its peer dependencies. Current docs describe **v2 with Effect**; the release inspected for this skill was `2.0.0-beta.81`. Verify current status rather than treating that version as permanent. Tell Nigel about beta risk before choosing it for production.
4. `await alchemy(...)`, lowercase `alchemy/cloudflare`, and `app.finalize()` identify v1. Use [v1 docs](https://v1.alchemy.run) for existing v1 projects. Read [migration guidance](https://alchemy.run/migrating-from-v1) before any agreed migration. Never mix generations or assume their state is compatible.

## Scaffold locally first

- Use pnpm for fresh projects and mise for missing runtimes. Preserve an existing project's package manager. Current prerequisites are Bun or Node.js 22+; check the selected release's requirements.
- Install Alchemy with matching Effect and platform packages from current docs/peer metadata. Do not blindly combine `alchemy@latest` with an incompatible Effect release. Commit the lockfile.
- Declare the smallest stack that meets the app's needs. A static site needs assets hosting, not a tutorial R2 bucket. Add compute and persistence only when required. See [reference.md](reference.md) for the tested SPA path.
- Choose state deliberately before first deployment. `localState()` avoids a remote state service for a solo demo but needs private backups and one deployment owner. `Cloudflare.state()` supports shared deployment state but can provision resources during bootstrap. Do not silently migrate an existing state backend.
- Keep logical IDs, stack names, physical names, and stage selection stable. Wire resources through typed bindings rather than copying secrets into source.
- Ignore `.alchemy/`, `.env`, and secret-bearing `.env.*` files, while allowing a placeholder-only `.env.example`. Record commands, versions, profile, stage, state backend, and recovery steps in the project's README.

## Cloud changes require approval

Before each deploy, report the exact account/profile, stage, resource changes, likely costs, verification, and recovery path. Obtain current explicit approval. A request to create a skill or scaffold an app is not deployment approval. Distinguish published free-tier allowances from the account's actual subscription and usage.

- Authenticate interactively with `pnpm alchemy profile edit --add Cloudflare`. Deploy is not the login command. Never ask Nigel to paste credentials into chat or export `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` as the default local setup. Do not read or print `~/.alchemy/profiles.json` or state-store credentials.
- Explicitly select profile and stage. Do not assume defaults mean production. Plan and deploy must target the same stack/profile/stage.
- `plan` normally previews changes, but first-use `Cloudflare.state()` can bootstrap a Worker, Durable Object, and secrets even during planning. Review and approve bootstrap separately.
- In a non-interactive terminal, `--yes` may convey current explicit approval of the exact reviewed operation when its target and plan are unchanged. The flag is not permission. Without that approval, stop; if the scope changes, report the change and obtain approval again.
- `dev` implies automatic approval. Unsupported local resources and `Alchemy.remote()` can run live. Inspect the whole stack, state backend, and actions before calling it local-only. Never run dev against production.
- Tests deploy and destroy real resources by default. Use verified emulated tests with `Test.make({ dev: true })`; inspect for remote/live-only resources and side effects. `LOCAL=1` works only when the test code reads it. Live tests need approval for both creation and teardown and a unique disposable stage.
- Never delete state to fix a failed deploy. Never blindly adopt, rename, destroy, or nuke resources. Preserve state, inspect ownership and the plan, and obtain approval for recovery or destructive operations. Isolated stages do not guarantee safety when physical names are hardcoded.

## Verify and hand off

Run typecheck, lint, build, and verified local tests first. For a Worker-backed site, verify the deployment build as well as the frontend build, including exported Durable Object classes. After an approved deployment, confirm the actual resource/output and smoke test it; include any live test writes in the approval. Report local checks separately from live verification.

For persistent resources, rollback must preserve the class exports, binding identities and migration history unless a reviewed data migration or deletion is explicitly approved. Reverting to an old assets-only definition can delete session data. An Alchemy state backup is not a database backup. If approval or access is missing, stop with the exact blocker, not a success claim.

See [reference.md](reference.md) for the minimal stack, command checks, and topic links.
