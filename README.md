# my-pi

Custom [pi](https://github.com/badlogic/pi-mono) extensions, skills, and agents.

## Structure

```
AGENTS.md      # Global workflow preferences (copy to ~/.pi/agent/AGENTS.md)
SETUP.md       # Step-by-step setup instructions for pi to follow
extensions/    # Pi extensions (auto-loaded via settings)
skills/        # Pi skills (auto-loaded via settings)
agents/        # Subagent definitions (copy to ~/.pi/agent/agents/)
```

## Setup

### Quick Bootstrap

```bash
git clone https://github.com/noahsaso/my-pi ~/.my-pi
cd ~/.my-pi && pi "Read SETUP.md and walk me through setting up pi with my custom extensions, skills, and agents. Do each step, ask me for input when needed (API keys, versions), and verify everything works at the end."
```

### Manual Setup

#### 1. Settings

Copy the example settings to your pi config:

```bash
cp ~/.my-pi/settings.example.json ~/.pi/agent/settings.json
```

Or merge into your existing `~/.pi/agent/settings.json`.

#### 3. Agents

Copy agent definitions for the subagent extension:

```bash
mkdir -p ~/.pi/agent/agents
cp ~/.my-pi/agents/*.md ~/.pi/agent/agents/
```

#### 4. Skills (web search + browser)

Install dependencies for the bundled skills:

```bash
cd ~/.my-pi/skills/brave-search && npm install
cd ~/.my-pi/skills/browser-tools && npm install
```

#### 5. Environment Variables

Add to your shell profile (`~/.profile`, `~/.bashrc`, or `~/.zshrc`):

```bash
export BRAVE_API_KEY="your-brave-api-key"
```

Get a free Brave Search API key at https://api-dashboard.search.brave.com/register (requires a "Free AI" subscription).

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

### subagent/

Delegate tasks to specialized subagents with isolated context windows. From pi's [built-in example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent).

**Tool:** `subagent` (single, parallel, or chained execution)
**Prompts:** `/implement`, `/scout-and-plan`, `/implement-and-review`

| Agent | Purpose | Model |
|-------|---------|-------|
| `scout` | Fast codebase recon | Haiku 4.5 |
| `planner` | Implementation plans | Opus 4.6 |
| `reviewer` | Code review | Opus 4.6 |
| `worker` | General-purpose | Opus 4.6 |

Features:
- Each subagent runs in an isolated `pi` process (no context pollution)
- Parallel execution (up to 8 tasks, 4 concurrent)
- Chaining with `{previous}` placeholder for sequential pipelines
- Streaming output with live progress
- Works with superpowers' subagent-driven-development skill

### clipboard.ts

Read/write the system clipboard. Cross-platform: macOS (`pbcopy`/`pbpaste`), Linux (`xclip`, `xsel`, or `wl-copy`/`wl-paste`). Skips registration silently on unsupported platforms.

**Tools:** `clipboard_read`, `clipboard_write`

Large clipboard contents are automatically truncated.

### notifications/

System notifications with a custom chime sound. Plays a ping when the agent needs your attention. Cross-platform: macOS (`osascript` + `afplay`), Linux (`notify-send` + `paplay`/`aplay`/`ffplay`). Skips registration silently on unsupported platforms.

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
| **brave-search** | Web search + page content extraction | `BRAVE_API_KEY` |
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
| [pi-context](https://github.com/ttttmr/pi-context) | npm | Git-like context management (`/context`, `context_tag`, etc.) |
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
