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
AGENTS.md         # Instructions for changing this my-pi repository
GLOBAL_AGENTS.md  # Global workflow preferences (copy to ~/.pi/agent/AGENTS.md)
SETUP.md          # Step-by-step setup instructions for pi to follow
extensions/    # Pi extensions (auto-loaded via settings)
skills/        # Pi skills (auto-loaded via settings)
prompts/       # Slash prompt templates (loaded via the `prompts` setting)
agents/        # Subagent definitions (source of truth; optionally copied to ~/.pi/agent/agents/ for legacy compatibility)
```

## Setup

### Quick Bootstrap

```bash
git clone https://github.com/NigelThorne/my-pi ~/.my-pi
cd ~/.my-pi && pi "Read SETUP.md and walk me through setting up pi with my custom extensions, skills, prompts, and agents. Do each step, ask me for input when needed (API keys, versions), and verify everything works at the end."
```

### Manual Setup

#### 1. Settings

Copy the example settings to your pi config:

```bash
cp ~/.my-pi/settings.example.json ~/.pi/agent/settings.json
```

Or merge into your existing `~/.pi/agent/settings.json`.

#### 2. Prompts

`/worker` is the generic coding prompt from `prompts/worker.md`; `/mycelium-worker` is the Mycelium-assignment prompt from `prompts/mycelium-worker.md`. Both are loaded through the configured `prompts` source (`~/.my-pi/prompts` in `settings.example.json`). Discover or edit slash prompts under `prompts/` or your configured prompt directories.

#### 3. Agents

Subagent definitions are version-controlled in `~/.my-pi/agents/`. The interactive subagents extension reads them from there, so `~/.pi/agent/agents` should not be used as the source of truth.

For compatibility with older extension versions, you can still sync copies:

```bash
mkdir -p ~/.pi/agent/agents
cp ~/.my-pi/agents/*.md ~/.pi/agent/agents/
```

`/subagent mycelium-worker <task>` invokes the Mycelium-specific profile from `~/.my-pi/agents/mycelium-worker.md`. The generic `/subagent worker <task>` profile is supplied by the interactive subagents package and does not use Mycelium. A project-local `.pi/agents/<name>.md` can override either profile. Discover or edit custom subagent profiles in `~/.my-pi/agents/`; `~/.pi/agent/agents/` is only a legacy compatibility copy location. Do not edit subagent profiles under `prompts/`.

The `/mycelium-worker` prompt starts a Mycelium-guided session in the current context, while `/subagent mycelium-worker <task>` launches the isolated Mycelium worker profile.

#### 4. Extension Dependencies

Install dependencies for extensions that need them:

```bash
cd ~/.my-pi/extensions/web-tools && npm install
cd ~/.my-pi/extensions/code-ast && npm install
```

#### 5. Web and browser access

Use `websearch` to find public pages and `webfetch` to read known URLs. Neither requires an API key or a browser.

For JavaScript rendering and local UI tests, use the project's browser test framework or the separately installed `webapp-testing` skill with an isolated headless browser. Check its dependencies before use.

The `chrome-cdp` package is configured in `settings.example.json`. It accesses an existing Chrome session and requires Node.js 22+, Chrome remote debugging, and Nigel's explicit approval. It is not the default for automated QA.

#### 6. Superpowers Skills

[Superpowers](https://github.com/obra/superpowers) skills are bundled in `skills/` alongside the other skills. No separate installation needed.

## Extensions

### pi-session-manager-presence.ts

Publishes exact local presence for every persisted Pi session to `~/.pi/agent/session-manager/live/` in two files:

- `<sessionID>.json` is the atomically replaced current-state snapshot that Pi Session Manager already reads.
- `<sessionID>.jsonl` is an append-only history. Each publication adds the same full JSON record, including `pid`, `state`, and `updatedAt` in Unix milliseconds, followed by a newline. Session IDs are URI-encoded in both filenames.

Publications include startup, each 15-second heartbeat, activity updates, explicit registration, and graceful shutdown. The extension never truncates or deletes the JSONL history on session switches or restarts. It does not backfill older snapshots or rotate the log. Both files are created with owner-only permissions. They are not a transaction: history is appended before snapshot replacement, and a failed history append is logged without blocking the snapshot update. The files record presence; they do not lock a session against duplicate Pi processes.

Pi Session Manager continues to use the snapshot to match the session ID and Pi session JSONL path, then displays **Processing** or **Idle** without guessing from CWD. No PSM reader changes are required yet.

The extension is loaded automatically because `~/.pi/agent/settings.json` includes `~/.my-pi/extensions`. Run `/reload` or restart already-open Pi sessions to activate it. A clean shutdown publishes a `stopped` record. PSM may prune stale JSON snapshots; the JSONL history remains.

Test it with:

```bash
node --test ~/.my-pi/extensions/pi-session-manager-presence{,-history}.test.mjs
```

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

Note: `/subagent worker <task>` selects the package's generic implementation profile. `/subagent mycelium-worker <task>` selects the custom Mycelium profile from `~/.my-pi/agents/mycelium-worker.md` (or its legacy compatibility copy), while `/mycelium-worker` is the separate prompt template from `prompts/mycelium-worker.md`.

| Agent | Purpose | Model |
|-------|---------|-------|
| `scout` | Fast codebase recon | Haiku 4.5 |
| `planner` | Brainstorming & planning | Opus (medium thinking) |
| `worker` | Generic implementation | Codex GPT-5.4 |
| `mycelium-worker` | Mycelium assignment implementation | Codex GPT-5.5 |
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

Handoff tools are hidden outside an active handoff. The successor sees only `pass_the_buck_ask` and `pass_the_buck_take_over`; the predecessor sees only `pass_the_buck_reply`. Explicit tool exclusions remain respected, and takeover hides the tools again.

These tools are not a subagent-to-parent messaging channel. An ordinary child that is blocked, with no independent work left, should summarize the blocker and exact question, then call `subagent_done` with that summary to return control to its parent. `subagent_steer` only sends instructions from parent to child.

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

Default tools for public web search and page retrieval without a browser.

**Tools:** `webfetch`, `websearch`

Features:
- `websearch` — Search the web via Exa AI's free MCP endpoint (no API key required). Supports search types (`auto`, `fast`, `deep`), live crawl modes, and configurable result counts.
- `webfetch` — Fetch any URL and return content as markdown (default), text, or HTML. Uses Readability + Turndown for clean article extraction. Handles Cloudflare bot detection, configurable timeout (max 120s), 5MB size limit.
- Custom TUI rendering for both tools
- Output truncation to prevent context overflow

### Gemini image generation

The [gemini-image skill](skills/gemini-image/SKILL.md) generates PNG images through the saved Gemini website login using [HanaokaYuzu/Gemini-API](https://github.com/HanaokaYuzu/Gemini-API). It requires macOS and `uv`, stores credentials in macOS Keychain, and uses the account's website quota rather than a paid API key.

Run `/skill:gemini-image` or ask Pi to generate an image. The skill's helper supports explicit browser authentication, generation, local login status, and logout. Generation does not access Chrome. Authentication requires permission and an explicit Gemini tab and account.

The old `generate_image` extension is preserved at `disabled/antigravity-image-gen.ts`, outside extension discovery. Run `/reload` in existing Pi sessions to load the new skill and remove the old tool. To restore the old provider, move that file back to `extensions/` and reload.

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

Bundled in `skills/`, including workflow skills from [obra/superpowers](https://github.com/obra/superpowers). Browser access is described in the setup section above.

| Skill | Description | Requires |
|-------|-------------|----------|
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
