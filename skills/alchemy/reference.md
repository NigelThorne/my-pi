# Alchemy reference

Fetch current docs before using examples. The v2 API and Effect package versions may change while Alchemy is in beta.

## Smallest Cloudflare stack

From [getting started](https://alchemy.run/getting-started). This file declares infrastructure; running it through Alchemy can create cloud resources. Writing it does not authorize deployment.

```typescript
// alchemy.run.ts
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "MyApp",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.Bucket("Bucket");
    return { bucketName: bucket.bucketName };
  }),
);
```

Choose the stack name before first deployment. The remote state store is account-shared by default. Its first-use bootstrap requires separate approval and it must not be destroyed as routine project cleanup.

Prove the first approved resource is live before adding downstream resources. If Nigel has not specified an app, ask what he wants to build after that checkpoint. If the requirements are already clear, continue toward those requirements rather than forcing tutorial steps.

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
