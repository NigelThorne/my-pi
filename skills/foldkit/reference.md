# Foldkit reference for sites

## Scaffold, then use the generated scripts

```sh
# In an agreed parent directory; scaffolder creates and installs a new project.
pnpm create foldkit-app@latest
# Select project name, rendering mode, and pnpm in its prompts.
cd your-project
pnpm dev
```

Check the target directory first; never scaffold over unrelated files. SPA offers example starters; SSG and SSR have mode-specific starters. Prefer those templates to handwritten guessed runtime APIs. Inspect `package.json` before running commands. Generated lint and format scripts exist, but confirm whether formatting writes or checks. Use the project's configured typecheck and test commands rather than inventing script names.

Read [getting started](https://foldkit.dev/get-started.md), [architecture](https://foldkit.dev/core/architecture.md), and the closest [example](https://foldkit.dev/example-apps). The minimal Counter keeps pure Model, Message, update, init and view definitions in `src/main.ts`; `src/entry.ts` owns `Runtime.makeApplication` and startup. Larger apps split by behaviour and ownership.

## SSG and SSR contract

Read [server rendering](https://foldkit.dev/core/server-rendering.md) and the matching installed-release example before editing config.

- `@foldkit/vite-plugin` coordinates client/server builds. Current SSR configuration uses `ssr: { serverEntry: '/src/entry.server.ts', build: true }`. SSG uses `build: { prerender: true }` and the server entry's finite path list. Copy the complete starter contract, not only these options.
- `renderToString` resolves init and runs the pure view, not update, browser lifecycles or returned Commands. Load required initial content in the documented server entry/Flags flow; a startup fetch Command does not make it appear in server HTML.
- `Runtime.hydrate` adopts server HTML. `Runtime.run` instead builds fresh DOM. Use the correct entry for the selected mode.
- Serialized Flags are public. SSG Flags must be universal; never include a visitor's private data. Read localStorage, viewport size or browser-only preferences after hydration so initial Models match.
- The coordinated build supplies one public build ID. Separate build jobs must share a unique ID for the same deployment. Do not disable mismatch checks or reuse one ID across differing builds. Keep client assets and HTML from the same build together.
- Serve SSG's generated client files from a static host. Use real missing-page behaviour, not an unconditional SPA fallback. A static file cannot carry arbitrary HTTP status, redirect or per-response headers; configure those at the host.
- SSR needs client asset serving plus the built `dist/server/fetch.js` handler for page requests. Inspect `foldkit.build.json` for actual paths. Do not point a static host at an SSR output or enable an SPA fallback instead of calling the handler.
- Keep personalized SSR responses out of shared caches. Set appropriate `Cache-Control` and `Vary`, using `private, no-store` for sensitive personalized HTML.
- Test a fresh load of the built app, not just Vite HMR. Check returned content/metadata with HTTP requests, then hydration and navigation in an isolated test browser. Successful hydration removes `data-foldkit-build`; `data-foldkit-refused` indicates failure. Also check warnings and interactions, since subtree rebuilding can hide a mismatch.

A page-owning view returns a Document with `title` and `body`; it can also supply `lang`, `dir`, `canonical`, and `ogUrl`. Set other SEO metadata through the version-matched shell/server mechanism. Do not invent arbitrary Document fields. [View docs](https://foldkit.dev/core/view.md) explain canonical omission semantics and unsafe raw-HTML sinks.

## Alchemy integration

The [Alchemy Cloudflare Foldkit guide](https://alchemy.run/cloudflare/frontend/foldkit) describes `Cloudflare.Website.Foldkit` as a client-only Vite site, with SPA fallback. That description does not cover Foldkit's newer server rendering.

For SPA, check the installed helper and its release-matched example. For SSG, verify that the build runs prerendering and the host serves the actual generated files with correct 404 behaviour. For SSR, verify an adapter that serves assets and invokes Foldkit's built fetch handler. If support is unclear, report the gap instead of claiming the helper is enough.

Check Effect peer compatibility if infrastructure and frontend share a package root. Separate workspace packages if their requirements conflict. Never resolve conflicts with force flags alone. Read the `alchemy` skill before provisioning or running Alchemy dev/tests.

## Release-matched source and upgrades

Upstream recommends an optional read-only `repos/foldkit/` git subtree. Adding it changes repository size and history; explain that and agree before vendoring. Otherwise fetch targeted source at the installed release tag, `foldkit@<version>`, not `main`. Canary installs use their source commit instead of a release tag. Application imports still come from npm packages, never the reference tree.

On upgrade:

1. Update compatible packages and lockfile, then run focused tests/build.
2. Re-pin any reference subtree to the installed release.
3. Refresh `FOLDKIT.md` from that release's `packages/create-foldkit-app/templates/base/FOLDKIT.md`. Preserve any accidental personal edits first by moving them to `AGENTS.md` with review. Never overwrite `AGENTS.md`.
4. Recheck SSR/SSG build and hydration, since server rendering is experimental.

The [upstream skills](https://foldkit.dev/ai/skills.md) provide `foldkit`, `generate-program`, and `audit-program`. Consult release-matched copies as references when useful. Do not install a second global `foldkit` skill with the same name. Even official skill prose can lag examples/types; verify component categories and embedding support against current APIs.

## DevTools and testing

- [Story](https://foldkit.dev/testing/story.md): Messages enter update; tests assert Models/Commands and supply result Messages without running Effects.
- [Scene](https://foldkit.dev/testing/scene.md): accessible locators drive the rendered VNode tree, not a browser DOM. Add separate tests for actual Command services, browser behaviour, accessibility, and hosting.
- [DevTools MCP](https://foldkit.dev/ai/mcp.md) is privileged app access. Scaffolds may include `.mcp.json`; do not assume Pi loads that automatically. Follow Pi's MCP docs before configuring it, and do not change global settings without agreement.
- Select an explicit runtime ID, not the most recently connected tab. Inspection can expose Models, history and arguments. Do not dump sensitive state.
- Replay pauses/changes the running UI; resume and dispatch change behaviour. Dispatch can trigger real Effects and external writes. Require approval for the targeted interaction, and use test data. Do not attach to Nigel's personal browser without permission.

## Topic lookup

[Docs index](https://foldkit.dev/llms.txt) · [Routing](https://foldkit.dev/core/routing-and-navigation.md) · [UI overview](https://foldkit.dev/ui/overview.md) · [Submodels](https://foldkit.dev/core/submodel.md) · [Project organisation](https://foldkit.dev/patterns/project-organization.md) · [Testing](https://foldkit.dev/testing.md) · [AI/source setup](https://foldkit.dev/ai/overview.md) · [Embedding](https://foldkit.dev/core/embedding.md)
