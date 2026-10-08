# Alchemy reference

Fetch current docs before using examples. The v2 API and Effect package versions may change while Alchemy is in beta.

## Choose resources and state

| Need | Starting point |
| --- | --- |
| Static SPA | Framework assets hosting; no R2 or database unless the app needs them |
| Shared persistent sessions | Worker plus SQLite Durable Objects; preserve the existing site's identity |
| Solo demo deployment state | Consider `localState()` with private backups and serialized deployments |
| Shared CI or multiple deployment owners | Choose shared state deliberately; review remote bootstrap and access first |

Local Alchemy state tracks cloud resource ownership. It does not make a deployment local, and it does not contain the app's durable database contents. Keep `.alchemy/` private. Do not switch state backends or copy a deployment to another checkout without a recovery plan.

The `Cloudflare.state()` store is account-shared by default. Its first-use bootstrap requires separate approval and it must not be destroyed as routine project cleanup.

## Minimal static Foldkit website

This v2 shape was exercised with Alchemy `2.0.0-beta.81`. Fetch [current getting started](https://alchemy.run/getting-started) and check installed APIs before reuse. Writing the file does not authorize deployment.

```typescript
import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import { localState } from 'alchemy/State/LocalState'
import * as Effect from 'effect/Effect'

export const Website = Cloudflare.Website.Foldkit('Website')

export default Alchemy.Stack(
  'MyApp',
  { providers: Cloudflare.providers(), state: localState() },
  Effect.gen(function* () {
    const website = yield* Website
    return { url: website.url }
  }),
)
```

Choose names before first deployment, then keep them stable. Follow agreed sequencing, but do not provision unrelated tutorial resources or force a bucket-first checkpoint for a website request.

## Commands and checks

These are references, not a script to execute in sequence. Replace `dev-nigel` and `default` with the agreed stage and profile. Inspect package scripts before running them, including tests and builds that might hide deploy commands.

| Intent | Command | Check first |
| --- | --- | --- |
| Package compatibility | `pnpm view alchemy@latest version peerDependencies --json` | Registry metadata is not proof of runtime compatibility |
| Installed CLI | `pnpm alchemy --help` | Use project-local CLI, not a different global release |
| Connect Cloudflare | `pnpm alchemy profile edit --add Cloudflare` | User-driven login; do not automate their browser |
| Review | `pnpm alchemy plan --stage dev-nigel --profile default` | Bootstrap, stack code and hooks may have side effects |
| Deploy | `pnpm alchemy deploy --stage dev-nigel --profile default` | Explicit approval of exact mutation |
| Development | `pnpm alchemy dev --stage dev-nigel --profile default` | All resources emulatable, no remote pins or cloud side effects; otherwise approval |
| Destroy | `pnpm alchemy destroy --stage dev-nigel --profile default` | Explicit deletion approval, correct ownership and state, data backups |

For a new project, install the Alchemy release selected above plus `effect`, `@effect/platform-bun`, and `@effect/platform-node` versions required by that release and current getting-started docs. Install TypeScript and runtime types as required by the project. Check imports with the actual compiler before reporting the scaffold as verified.

## Troubleshooting observed in the trial

These are observations from `2.0.0-beta.81`, not permanent workarounds to apply blindly.

- **Login reports `NonInteractiveTerminal`.** Alchemy detected Pi in PATH even in a user-driven interactive terminal. `ALCHEMY_TUI=1 pnpm alchemy profile edit --profile default --add Cloudflare` enabled its login UI. Use this only for that diagnosed login failure. Do not automate the user's browser, copy credentials, or treat the override as deployment approval.
- **First deploy reports `SubdomainNotFound`.** The account had no `workers.dev` subdomain. Have the user complete the account's Workers setup, or obtain approval for the exact cloud setup change. Keep partial Alchemy state; inspect the plan before retrying. Do not discard state or silently select another account.
- **An approved deploy cannot prompt.** After current approval of an unchanged exact plan, append `--yes` to that deployment command. Without approval, stop. Do not weaken approval checks or blanket-enable non-interactive writes.

## Tested shared-session example

[Little wins at the tested revision](https://github.com/NigelThorne/foldkit-demo/tree/b9ce57972e47f8378985c8818a2bf20d2111fef9) contains the Worker-backed SPA, local Miniflare runner and stack config. It is a learning example, not a production security template. Only the SPA path was exercised; this does not establish SSR or SSG support.

For this release, the existing `Website` declaration gained `main: 'server/worker.ts'`, a `SESSIONS` environment binding from `Cloudflare.DurableObject('WinSession', { className: 'WinSession' })`, and `assets: { runWorkerFirst: ['/api/*'] }`. Verify both the named class export and default Worker export survive the deployment build. The native Worker uses Cloudflare APIs; the frontend remains Foldkit and Effect.

The local-only runner bundles that same Worker into Miniflare with `useSQLite: true`, a private persistence directory and local static assets. No cloud credentials are needed. Each stack gets a separate directory and port; stop/start preserves that stack's SQLite files. A fresh Miniflare restart test and two-browser checks verify more than frontend unit tests alone.

For rollback after sessions exist, retain the `WinSession` export, `SESSIONS` binding and migrations. An older assets-only stack can remove the class and its data. Preserve cloud ownership state and app data separately. The published example documents its cost assumptions; confirm current provider pricing and account plan rather than promising unlimited free use.

## Common mistakes

| Mistake | Correct approach |
| --- | --- |
| Copying an old async/await example into v2 | Check package generation; use `Alchemy.Stack`, `Effect.gen`, `yield*`, and case-sensitive `alchemy/Cloudflare` |
| Treating the homepage's first-deploy login wording as authoritative | Current getting-started requires `profile edit`; unauthenticated deploy fails with login instructions |
| Calling every `dev` resource local | Only emulatable resources are local; unsupported resources and `Alchemy.remote()` run live |
| Assuming a dry run can never provision | State-store bootstrap can write before planning; arbitrary stack code can have effects |
| Relying on per-user test stages for concurrency | Use unique per-run or per-PR stages and serialize updates to a shared stage |
| Regenerating missing state or casually renaming IDs | Inspect state/ownership first; names and IDs control identity and replacement |
| Migrating v1, then destroying the old stack | Both states may refer to the same live resources; follow reviewed migration/recovery steps |

## Read only what the project needs

- [Docs index](https://alchemy.run/llms.txt), includes Cloudflare, AWS, GCP, Prisma, Fly and other integrations. Support varies by resource.
- [Getting started](https://alchemy.run/getting-started)
- [CLI](https://alchemy.run/cli)
- [Profiles](https://alchemy.run/environments/profiles) and [stages](https://alchemy.run/environments/stages)
- [State store and bootstrap](https://alchemy.run/state-store)
- [Local development](https://alchemy.run/environments/local-development) and [CLI dev](https://alchemy.run/cli/dev)
- [Testing](https://alchemy.run/testing) and [test harness](https://alchemy.run/testing/test-harness)
- [Secrets and config](https://alchemy.run/environments/secrets)
- [Migration from v1](https://alchemy.run/migrating-from-v1) and [adopting resources](https://alchemy.run/cli/adopting-resources)
- [Cloudflare first stack](https://alchemy.run/cloudflare/tutorial/part-1), [Worker](https://alchemy.run/cloudflare/tutorial/part-2), [tests](https://alchemy.run/cloudflare/tutorial/part-3), [local dev](https://alchemy.run/cloudflare/tutorial/part-4), [CI/CD](https://alchemy.run/cloudflare/tutorial/part-5)

For CI, review the current provider guide before choosing credentials. Keep credentials in the CI secret store, use isolated preview stages and shared remote state, and agree deployment and cleanup policies before enabling workflows. Do not copy local profile credentials into a repository or enable production deployment implicitly.
