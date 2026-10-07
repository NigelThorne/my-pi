---
name: foldkit
description: Use when starting a new website or interactive frontend for Nigel, trying Foldkit for sites, or working with foldkit imports, FOLDKIT.md, Model/Message/update architecture, Foldkit UI, routing, server rendering, static generation, or Story and Scene tests.
---

# Foldkit sites

Nigel wants to try Foldkit for sites. Consider it for new website work, and use it when requested. Do not rewrite an existing frontend or force it onto a server-only project. Foldkit is a TypeScript frontend framework built on Effect and The Elm Architecture, not React.

## Choose the rendering mode

| Site | Starting choice |
| --- | --- |
| Public portfolio, landing pages, blog, finite content routes | SSG for useful initial HTML and static hosting |
| Interactive dashboard where public indexing is unimportant | SPA |
| Pages requiring request-specific initial content | SSR, with an explicit server host and cache policy |

Foldkit is beta. Its server rendering, including SSG, currently lives in `foldkit/experimental/server` and can change between releases. Explain that trade-off briefly. Mostly prose sites may be simpler in Astro, but honour Nigel's request to experiment with Foldkit rather than silently substituting it.

## Start from current, matching sources

1. Read project instructions, `AGENTS.md`, `FOLDKIT.md`, package versions, and lockfile. Fetch [getting started](https://foldkit.dev/get-started.md) and [docs index](https://foldkit.dev/llms.txt). Fetch individual pages as `.md`; avoid loading all of `llms-full.txt`.
2. Prefer the official scaffolder. Current setup requires Node **22.22.2+**. Use mise for missing runtimes and pnpm for new projects. Run `pnpm create foldkit-app@latest`, choose the agreed rendering mode and pnpm, then inspect generated files and scripts. Preserve an existing package manager.
3. Scaffolded packages are compatible. For manual installs/upgrades, check exact peers before editing dependencies. At review, Foldkit `0.166.0` pins `effect` and `@effect/platform-browser` to `4.0.0`. Do not assume independently selected latest versions work. Pin deployed Foldkit versions and commit the lockfile.
4. Use installed types and release-matched examples over remembered APIs. See [reference.md](reference.md) for source lookup and upgrades. Do not silently overwrite personal instructions.

## Keep the Foldkit architecture

- Schema defines the immutable Model and Messages. Name Messages as facts, such as `ClickedSubmit` or `SucceededLoadPosts`.
- `update` is exhaustive and pure, returning the next Model and explicit Commands. `view` is pure; event handlers construct Messages rather than fetching or mutating state.
- Use Commands for one-shot Effects, Subscriptions for ongoing Streams, Mounts for element lifecycles, and ManagedResources for scoped live handles. Keep handles out of the Model.
- Keep runtime startup in `src/entry.ts`, separate from importable application definitions. Use Submodels when ownership warrants them, not for every view fragment.
- Prefer typed routing and Foldkit/Effect facilities before adding other frameworks. Use `@foldkit/ui` where appropriate; distinguish stateful Submodels from stateless helpers using current component docs. Do not assume React packages or JSX are compatible. Existing-host widgets use the documented embedding API, not a rewrite.

## Build readable sites

Use semantic headings, landmarks, labelled inputs, keyboard navigation, visible focus and reduced-motion support. For Nigel, favour open regular-weight fonts, comfortable spacing, short labels, and visuals. Avoid dense bold headings, negative letter-spacing, and colour-only meaning.

For public routes, verify initial HTML, titles, canonical URLs, descriptions/share metadata, deep links and real 404 behaviour. Keep credentials out of browser bundles, `VITE_*`, serialized Flags and DevTools data. Do not render untrusted content through raw HTML attributes.

## Test before hosting

Run the generated formatting checks, lint, typecheck and build. Use Story for transitions/Command wiring and Scene for view interactions. Neither executes Command Effects or proves browser layout, network integration or hydration; test those separately.

For SSG/SSR, read [reference.md](reference.md) before implementing. Verify the built site and fresh-page hydration with an isolated headless browser when available. Do not take over Nigel's desktop or attach to his browser without permission.

For Alchemy hosting, also load the `alchemy` skill. Its Foldkit website helper is documented as SPA hosting; do not assume it handles SSG or SSR. Match the host to actual build output and test deep links. Cloud writes still require approval. Report local checks separately from deployed verification.
