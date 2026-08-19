# my-pi

Custom [pi](https://github.com/badlogic/pi-mono) extensions, skills, and agents.

## Provenance

This repo is Nigel Thorne's personal fork of `my-pi`.

- Current home: <https://github.com/NigelThorne/my-pi>
- Originally forked from: <https://github.com/noahsaso/my-pi>
- Local policy: day-to-day work should push to Nigel's fork/remotes, not to the original upstream.

Some submodules also began on upstream repos and are now pointed at Nigel-owned forks when local customizations are needed:

- `extensions/pi-interactive-subagents`: originally `noahsaso/pi-interactive-subagents`, now `NigelThorne/pi-interactive-subagents`
- `extensions/pi-remote`: originally `noahsaso/pi-remote`, now `NigelThorne/pi-remote`

## Structure

```
AGENTS.md      # Global workflow preferences (copy to ~/.pi/agent/AGENTS.md)
SETUP.md       # Step-by-step setup instructions for pi to follow
extensions/    # Pi extensions (auto-loaded via settings)
skills/        # Pi skills (auto-loaded via settings)
prompts/       # Slash prompt templates (loaded via the `prompts` setting)
agents/        # Subagent definitions (source of truth; optionally copied to ~/.pi/agent/agents/ for legacy compatibility)
```

## Setup

### Quick Bootstrap

```bash
git clone https://github.com/NigelThorne/my-pi ~/.my-pi
cd ~/.my-pi && pi "Read SETUP.md and walk me through setting up pi with my custom extensions, skills, and agents. Do each step, ask me for input when needed (API keys, versions), and verify everything works at the end."
```

### Manual Setup

#### 1. Settings

Copy the example settings to your pi config:

```bash
cp ~/.my-pi/settings.example.json ~/.pi/agent/settings.json
```

Or merge into your existing `~/.pi/agent/settings.json`.

#### 2. Prompts

`/worker` is a slash prompt template, loaded from `prompts/worker.md` through the configured `prompts` source (`~/.my-pi/prompts` in `settings.example.json`). Discover or edit slash prompts under `prompts/` or your configured prompt directories.

#### 3. Agents

Subagent definitions are version-controlled in `~/.my-pi/agents/`. The interactive subagents extension reads them from there, so `~/.pi/agent/agents` should not be used as the source of truth.

For compatibility with older extension versions, you can still sync copies:

```bash
mkdir -p ~/.pi/agent/agents
cp ~/.my-pi/agents/*.md ~/.pi/agent/agents/
```

`/subagent worker <task>` invokes the `worker` subagent profile from `~/.my-pi/agents/worker.md` through the interactive subagents extension. Discover or edit subagent profiles in the source directory `~/.my-pi/agents/`; `~/.pi/agent/agents/` is only a legacy compatibility copy location. Do not edit subagent profiles under `prompts/`.

These are complementary entry points: `/worker` starts a prompt-guided session in the current context, while `/subagent worker <task>` launches an isolated worker subagent pane/profile. Neither replaces the other.

#### 4. Extension Dependencies

Install dependencies for extensions that need them:

```bash
cd ~/.my-pi/extensions/web-tools && npm install
cd ~/.my-pi/extensions/code-ast && npm install
```

#### 5. Skills (browser + legacy search)

Install dependencies for the bundled skills:

```bash
cd ~/.my-pi/skills/browser-tools && npm install
cd ~/.my-pi/skills/brave-search && npm install   # optional — legacy fallback
```

#### 6. Environment Variables (optional)

Only needed if you use the legacy brave-search skill. Add to your shell profile (`~/.profile`, `~/.bashrc`, or `~/.zshrc`):

```bash
export BRAVE_API_KEY="your-brave-api-key"
```

Get a free Brave Search API key at https://api-dashboard.search.brave.com/register (requires a "Free AI" subscription).

> **Note:** The `websearch` and `webfetch` tools (in `extensions/web-tools/`) require **no API keys** and are the preferred way to search the web and fetch pages.

#### 6. Superpowers Skills

[Superpowers](https://github.com/obra/superpowers) skills are bundled in `skills/` alongside the other skills. No separate installation needed.

## Extensions

### todo.ts

Markdown-based todo tracking with dependency support.

**Tools:** `todo_list`, `todo_add`, `todo_toggle`, `todo_remove`
**Command:** `/todos`

Features:
- Items can declare dependencies on other items by index
- Cannot complete an item until its dependencies are done
- Removing items automatically rewrites dependency indices
- State persists across session branches/forks
- Interactive TUI view via `/todos`

### pi-interactive-subagents/ (package)

Async subagent orchestration in multiplexer panes. From [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents). Included as a git submodule loaded as a pi package.

**Tools:** `subagent`, `subagents_list`, `set_tab_title`, `subagent_resume`, `write_artifact`, `read_artifact`
**Commands:** `/plan`, `/iterate`, `/subagent <agent> <task>`

Note: `/subagent worker <task>` selects the `worker` profile from the source directory `~/.my-pi/agents/worker.md` (or the legacy compatibility copy at `~/.pi/agent/agents/worker.md` for older extension versions). The separate `/worker` command is a slash prompt template from `prompts/worker.md` (or another configured prompt source).

| Agent | Purpose | Model |
|-------|---------|-------|
| `scout` | Fast codebase recon | Haiku 4.5 |
| `planner` | Brainstorming & planning | Opus (medium thinking) |
| `worker` | Implementation | Sonnet |
| `orchestrator` | Mycelium workstream coordination | Opus |
| `reviewer` | Code review | Opus (medium thinking) |
| `visual-tester` | Visual QA via Chrome CDP | Sonnet |

Features:
- **Fully async** — `subagent()` returns immediately, sub-agent runs in a dedicated mux pane
- Live widget shows all running agents with elapsed time and progress
- Results steered back as async notifications when complete
- Multiple subagents run concurrently
- `/plan` — Full planning-to-implementation pipeline (investigate → plan → execute → review)
- `/iterate` — Fork current session into a subagent for quick focused fixes
- Session artifacts (`write_artifact`/`read_artifact`) for plans, context, and notes
- Agent access control via `spawning: false` and `deny-tools` frontmatter
- Role folders with per-agent `cwd` and config
- Requires a terminal multiplexer (cmux, tmux, or zellij)

### pass-the-buck/

Starts an independent successor Pi session in a Zellij pane with a compact, generated checkpoint rather than the active conversation.

**Command:** `/pass-the-buck [optional successor objective]`

The command summarizes the active effective context (including any existing compaction summaries) into a self-contained handoff checkpoint, then starts a fresh Pi session with that checkpoint, the project configuration, and the shared working directory. It must use `pass_the_buck_take_over` once it is ready to own the work. Until then it can call `pass_the_buck_ask` to ask the predecessor questions; the predecessor replies with `pass_the_buck_reply`.

After takeover, the predecessor runs `/retro` when at least 20% (and 16K tokens) of its context window remains; otherwise it exits gracefully. The relay is durable at `~/.pi/agent/pass-the-buck/`, allowing the sessions to survive a reload while the handoff is in progress.

### mycelium-watchdog/

Personal behavior layer for sessions using `mycelium-pi`. It does not start Mycelium or register Mycelium tools; it reads the existing Mycelium inbox/session files and nudges agents that own active work but are not progressing.

Features:
- 1-minute heartbeat.
- Pokes after 2 minutes with active work and no progress.
- Keeps a pending progress expectation open after a poke; it does not restart the timer just because it poked.
- Immediately re-prompts when an agent responds with ACK/intent only and no meaningful tool action.
- Escalates after repeated/no-progress watchdog prompts.
- Writes `.mycelium/nigel-watchdog-<session-id>.json` so idle sessions can be diagnosed.

### clipboard.ts

Read/write the system clipboard. Cross-platform: macOS (`pbcopy`/`pbpaste`), Linux (`xclip`, `xsel`, or `wl-copy`/`wl-paste`). Skips registration silently on unsupported platforms.

**Tools:** `clipboard_read`, `clipboard_write`

Large clipboard contents are automatically truncated.

### notifications/

System notifications with a custom chime sound. Plays a ping when the agent needs your attention. Cross-platform: macOS (`notify-me` + `afplay`), Linux (`notify-send` + `paplay`/`aplay`/`ffplay`). Skips registration silently when the required notification command is unavailable.

**Tools:** `notify`, `ask_user`
**Command:** `/ping`

Features:
- `notify` — Send a system notification with optional chime sound
- `ask_user` — Play chime + show notification + prompt for input (use when you need the user's attention)
- `/ping` — Test the chime sound
- Custom sound at `notifications/chime.mp3` (swap with any .mp3)

### file-watcher.ts

Watch files and directories for changes using Node's `fs.watch` API.

**Tools:** `watch_start`, `watch_stop`, `watch_list`, `watch_events`

Features:
- Watch files or directories (recursive supported)
- Optional glob pattern filtering (e.g. `*.ts`)
- Changes are debounced and batched (2s window)
- Batched change summaries sent to agent via `sendMessage`
- Watchers are ephemeral (cleaned up on session shutdown)

### code-ast/

TypeScript-aware code intelligence: find references, rename symbols, list declarations.

**Tools:** `ast_references`, `ast_rename`, `ast_symbols`

Features:
- **TS/JS files:** Uses the TypeScript compiler API with full type-system awareness (finds references through imports, renames across the project, understands tsconfig)
- **Other languages:** Falls back to `rg` (ripgrep) for references and rename
- `ast_symbols` lists functions, classes, interfaces, types, enums with export status
- Requires `typescript` npm package (installed in `code-ast/node_modules/`)

### web-tools/

Web search and content fetching — the **preferred** tools for web access (replaces brave-search for most use cases).

**Tools:** `webfetch`, `websearch`

Features:
- `websearch` — Search the web via Exa AI's free MCP endpoint (no API key required). Supports search types (`auto`, `fast`, `deep`), live crawl modes, and configurable result counts.
- `webfetch` — Fetch any URL and return content as markdown (default), text, or HTML. Uses Readability + Turndown for clean article extraction. Handles Cloudflare bot detection, configurable timeout (max 120s), 5MB size limit.
- Custom TUI rendering for both tools
- Output truncation to prevent context overflow

### antigravity-image-gen.ts

Image generation via Google Antigravity (gemini-3-pro-image, imagen-3).

**Tool:** `generate_image`

Features:
- Generates images from text prompts
- Configurable aspect ratio, model, and save location
- Requires Google OAuth: run `/login` for google-antigravity

### memory.ts

Persistent memory across sessions. Learns from corrections and saves lessons for future use.

**Tools:** `memory_save`, `memory_search`, `memory_list`, `memory_remove`

Features:
- **Project memories** stored in `<project>/.pi/memory/memories.json`
- **Global memories** stored in `~/.pi/agent/memory/memories.json`
- Auto-injected into system prompt at the start of each agent turn
- Fuzzy text search across all memories
- Track correction source (e.g. `source: "correction"`) for learning from mistakes
- Most recent 50 memories injected (keeps context manageable)

## Skills

Bundled in `skills/` (browser/search from [badlogic/pi-skills](https://github.com/badlogic/pi-skills), workflow skills from [obra/superpowers](https://github.com/obra/superpowers)).

| Skill | Description | Requires |
|-------|-------------|----------|
| **brave-search** | Web search + page content extraction (legacy — prefer `websearch`/`webfetch` tools) | `BRAVE_API_KEY` |
| **browser-tools** | Browser automation via Chrome DevTools Protocol | Chrome |
| **brainstorming** | Explores intent, requirements and design before creative work | — |
| **dispatching-parallel-agents** | Run 2+ independent tasks in parallel | — |
| **executing-plans** | Execute implementation plans with review checkpoints | — |
| **finishing-a-development-branch** | Guide branch completion (merge, PR, cleanup) | — |
| **receiving-code-review** | Process code review feedback with technical rigor | — |
| **requesting-code-review** | Verify work meets requirements before merging | — |
| **subagent-driven-development** | Execute plans via independent subagent tasks | — |
| **systematic-debugging** | Root-cause analysis before proposing fixes | — |
| **test-driven-development** | Write tests before implementation | — |
| **using-git-worktrees** | Create isolated worktrees for feature work | — |
| **using-superpowers** | Establishes how to find and use skills | — |
| **verification-before-completion** | Run verification commands before claiming done | — |
| **writing-plans** | Create multi-step implementation plans from specs | — |
| **writing-skills** | Create, edit, and verify skills | — |

### browser-tools

Tools: `browser-start.js`, `browser-nav.js`, `browser-eval.js`, `browser-screenshot.js`, `browser-resize.js`, `browser-pick.js`, `browser-cookies.js`, `browser-content.js`

`browser-resize.js` supports named device presets (`iphone`, `iphone-se`, `iphone-pro-max`, `ipad`, `ipad-pro`, `android`, `tablet`, `laptop`, `desktop`), custom `WxH` with `--dpr` and `--mobile` flags, and `reset` to clear overrides.

### brave-search

Tools: `search.js`, `content.js`

Usage: `/skill:brave-search "query"` or just ask naturally.

### superpowers

14 workflow skills from [obra/superpowers](https://github.com/obra/superpowers) that enforce disciplined development practices — brainstorming before building, writing tests before code, systematic debugging before fixing, and verification before claiming done. These are pure SKILL.md files with no dependencies.

## Packages

External pi packages:

| Package | Source | Description |
|---------|--------|-------------|
| [pi-context](https://github.com/ttttmr/pi-context) | git submodule | Git-like context management (`/context`, `context_tag`, etc.) |
| [pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents) | git submodule | Async subagent orchestration in multiplexer panes (`/plan`, `/iterate`, `subagent`) |
| [pi-remote](https://github.com/noahsaso/pi-remote) | git submodule | Remote terminal access via WebSocket and browser, with Tailscale integration |

### pi-remote (fork with Tailscale)

Included as a git submodule at `extensions/pi-remote/`. This is a fork of [@q.roy/pi-remote](https://github.com/ruanqisevik/pi-mono-extensions) with automatic Tailscale integration:

- On `/remote`, automatically runs `tailscale serve --bg --https 443 --set-path /pi/{session-id}/` to expose the remote session over HTTPS on your tailnet
- Each session gets a unique subpath with an auth token: `https://your-host.tailnet.ts.net/pi/abc123/?token=...`
- QR code modal shows the Tailscale URL when available (with LAN URL as fallback)
- Uses Tailscale's auto-provisioned TLS certificate (MagicDNS)
- The serve route is automatically cleaned up when the session exits (without affecting other `tailscale serve` routes)
- Falls back gracefully if Tailscale is not installed or not running
- TUI widget shows Tailscale URL, LAN URL, and token in a bordered card
- Token auth enforced on all connections (including localhost/Tailscale proxy)
- Browser auth modal prompts for token if missing/invalid
- Session ended overlay when pi exits; scroll-to-bottom button; styled 403/404 error pages

Setup:

```bash
cd ~/.my-pi
git submodule update --init --recursive
cd extensions/pi-remote/packages/remote && npm install && npm run build
```
