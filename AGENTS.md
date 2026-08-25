# Pi Global Instructions

## Custom Extensions

You have these custom tools available via extensions (loaded from `~/.my-pi/extensions/`):

### Todo Tracking (`todo_list`, `todo_add`, `todo_toggle`, `todo_remove`)

Use these tools to track work items during complex tasks. They support dependencies between items.

- `todo_add` — Add items with optional `depends` array (one-based indices). Items can't be completed until deps are done.
- `todo_list` — Show all items with status and blocked info.
- `todo_toggle` — Mark items complete/incomplete (enforces dependency order).
- `todo_remove` — Remove items (dependency indices auto-adjust).
- `/todos` — Interactive TUI view.

Use todos proactively when working on multi-step tasks, implementation plans, or any work with natural ordering.

### Interactive Subagents (`subagent`, `subagents_list`, `subagent_resume`, `set_tab_title`)

Spawn async subagents in dedicated multiplexer panes. Fully non-blocking — the main agent keeps working while subagents run in the background. Results steer back automatically when complete.

**Available agents:**
- `scout` (Haiku 4.5) — Fast codebase recon, returns structured findings for handoff
- `planner` (Opus, medium thinking) — Brainstorming, clarifies requirements, writes plans, creates todos
- `worker` (Codex GPT-5.4) — Generic implementation agent; implements tasks from todos, writes code, runs tests
- `mycelium-worker` (Codex GPT-5.5) — Implements Mycelium assignments and reports progress, blockers, and verification there
- `orchestrator` (Opus) — Drives Mycelium workstreams to completion by planning, allocating, monitoring, and escalating
- `reviewer` (Opus, medium thinking) — Code review for bugs, security, correctness
- `visual-tester` (Sonnet) — Visual QA via Chrome CDP, screenshots, responsive testing

**Tools:**
- `subagent` — Spawn a sub-agent in a mux pane (returns immediately)
- `subagents_list` — List available agent definitions
- `subagent_resume` — Resume a previous sub-agent session
- `set_tab_title` — Update tab/window title to show progress

**Session Artifacts:**
- `write_artifact` — Write plans, context, notes to session-scoped directory
- `read_artifact` — Read artifacts from current or previous sessions

**Commands:** `/plan`, `/iterate`, `/subagent <agent> <task>`

Use subagents for:
- Scouting unfamiliar codebases before planning
- Delegating independent implementation tasks
- Code review after completing work
- Parallel investigation (call `subagent` multiple times — they run concurrently)
- Full planning pipelines via `/plan`

### Nigel Mycelium Watchdog (`nigel-mycelium-watchdog`)

Personal Mycelium behavior layer on top of `mycelium-pi`. It does not register Mycelium tools or start the MCP server. It reads the active Mycelium inbox/session files, watches active claimed work, and prompts agents that are idle or that acknowledge work without making progress.

- Heartbeat: every minute.
- First poke: after 2 minutes without progress on active work.
- Pending progress: watchdog keeps the expectation open and does not restart the timer after each poke.
- Escalation: if there is still no progress by the escalation deadline, prompts the agent to escalate to the orchestrator or `@Nigel Thorne`.
- Audit file: `.mycelium/nigel-watchdog-<session-id>.json` records active activity, phase, last prompt, last assistant preview, last tool calls, and failed attempt count.

### Web Tools (`webfetch`, `websearch`)

Search the web and fetch page content. These are the **preferred** tools for web access — use them instead of brave-search.

- `websearch` — Search the web via Exa AI (no API key required). Use for discovery, finding docs, current events.
- `webfetch` — Fetch a URL and return content as markdown, text, or HTML. Use for retrieving specific pages.

Use `websearch` when you need to find information (discovery), and `webfetch` when you need to retrieve content from a specific URL (retrieval).

## Skills

### Web Search (`/skill:brave-search`)

**Legacy** — prefer the `websearch` and `webfetch` tools above. Only use brave-search as a fallback if the web tools are unavailable.

Search the web and extract page content via Brave Search API.

```bash
search.js "query"                    # Basic search
search.js "query" --content          # Include page content
content.js https://example.com       # Extract page content
```

### Browser Automation (`/skill:browser-tools`)

Full browser automation via Chrome DevTools Protocol. Use for interacting with web pages, testing UIs, or scraping dynamic content. Read the skill for setup and usage.

### Clipboard (`clipboard_read`, `clipboard_write`)

Read and write the system clipboard. Cross-platform (macOS + Linux). Not registered on unsupported platforms.

- `clipboard_read` — Read current clipboard contents
- `clipboard_write` — Write text to clipboard

### Notifications (`notify`, `ask_user`)

System notifications with a custom chime sound. Cross-platform (macOS + Linux).

- `notify` — Send a system notification with optional chime sound
- `ask_user` — Play chime + notification + prompt user for input. **Use this when you need the user's attention.**
- `/ping` — Test the chime sound

### File Watcher (`watch_start`, `watch_stop`, `watch_list`, `watch_events`)

Watch files and directories for changes. Changes are debounced and batched.

- `watch_start` — Start watching a path (supports recursive, glob patterns)
- `watch_stop` — Stop a watcher by ID
- `watch_list` — List active watchers
- `watch_events` — Get accumulated change events from a watcher

### Code AST (`ast_references`, `ast_rename`, `ast_symbols`)

TypeScript-aware code intelligence. Falls back to ripgrep for non-TS/JS files.

- `ast_references` — Find all references to a symbol
- `ast_rename` — Rename a symbol across the codebase (applies edits)
- `ast_symbols` — List all symbols in a file (functions, classes, types, etc.)

### Image Generation (`generate_image`)

Generate images via Google Antigravity (gemini-3-pro-image). Requires `/login` for google-antigravity.

### Persistent Memory (`memory_save`, `memory_search`, `memory_list`, `memory_remove`)

Persistent memory across sessions. Memories are auto-injected into the system prompt.

- `memory_save` — Save a memory (project-scoped or global). Use `source: "correction"` when learning from mistakes.
- `memory_search` — Fuzzy search across memories
- `memory_list` — List all memories
- `memory_remove` — Remove a memory by ID

**When the user corrects you, proactively save the lesson using `memory_save` with `source: "correction"`.**

Use memory for:
- Saving lessons learned from corrections/mistakes
- Remembering project conventions and preferences
- Storing decisions made during sessions

### Context Management (`/skill:context-management`)

Git-like context management for long sessions. Use `/context` to view token usage dashboard.

- `context_tag` — Create named milestones in conversation history
- `context_log` — Visualize conversation history and token usage
- `context_checkout` — Move HEAD to any tag/commit, compress completed tasks into summaries

Use context management for:
- Structuring long sessions with milestones
- Monitoring token usage
- Compressing completed work to free context space

### Side Conversations (`/btw`)

Have a separate conversation with the LLM while the main agent is working. Works during streaming.

- `/btw <message>` — Send a side message. Streams response in a widget above the editor.
- `/btw:new [message]` — Start a fresh thread (optionally with a message).
- `/btw:clear` — Dismiss widget and clear thread.
- `/btw:inject [instructions]` — Inject full btw thread into main agent context.
- `/btw:summarize [instructions]` — Summarize btw thread and inject summary into main agent context.

Use btw for:
- Asking clarifying questions while the agent works
- Planning next steps without interrupting the current task
- Thinking through ideas in a side channel

### Remote Access (`pi-remote`)

Remote terminal access for pi via WebSocket with Tailscale integration. Connect to your pi session from mobile browsers over LAN or your tailnet.

- `/remote` — Restart pi in remote mode from within a running session
- **QR code** — Scan to connect instantly from mobile
- **Token auth** — All connections require token authentication
- **Tailscale integration** — Automatically serves over HTTPS on your tailnet with a unique session subpath
- **Discovery service** — Lists all active remote sessions at `/pi/`

## Edit Tool Usage

When using the `edit` tool:

- `oldText` must match the file **exactly**, including whitespace, indentation, and line breaks.
- Each `oldText` must match **one unique location** in the original file by default.
- If you intentionally want to replace multiple identical occurrences, set `expectedOccurrences` to the exact positive integer count; do not guess and do not use an "all"/wildcard concept.
- If a snippet may appear multiple times unintentionally, include **more surrounding exact context** in `oldText` to make it unique.
- When adding extra context to make a match unique, preserve that unchanged context in `newText` too so it is not lost.
- Prefer slightly larger exact replacements over tiny ambiguous ones.
- If needed, re-read the relevant file section immediately before calling `edit` so the copied text matches exactly.
- If multiple edits are sent in one `edit` call, each `oldText` is matched against the **original file**, not after earlier replacements in that same call.

### Common `edit` failure modes

- “Found multiple occurrences” → make `oldText` more unique by including more surrounding exact context, or set `expectedOccurrences` to the exact count if you really intend to replace every occurrence.
- “Must match exactly including whitespace” → re-read the file and copy the exact indentation, spacing, and newlines.

## Git Workflow

### Trunk-based development for this repository

For this repository, use trunk-based development: work directly on `main`. Do not create or use Git branches or worktrees unless the user explicitly requests them.

### Draft PR safety rule

If an open PR has known breakage, failed verification, or any unresolved blocker that means it cannot responsibly merge, immediately convert it to **Draft**. Only mark it ready for review after the issue is fixed and the relevant verification is satisfactory.

### `git mm` (merge-master)

Use `git mm` to rebase the current feature branch onto the latest `main`. This is a smart rebase alias that:

1. Fetches the latest `origin/main`
2. Finds the squash-merge commit on `main` whose tree matches already-merged commits
3. Rebases only **new** commits onto that point, skipping commits that were already squash-merged

Use it after a PR is merged and you want to continue working on the same branch with new commits on top of the updated `main`.

## Workflow Preferences

- Use **superpowers skills** when available (brainstorming, writing-plans, subagent-driven-development, branch-driven-development, test-driven-development, etc.)
- Track multi-step work with **todo tools** — create todos at the start of complex tasks
- Use **subagents** for delegation — scout first, then plan, then implement
- Search the web with **`websearch`** and fetch pages with **`webfetch`** — prefer these over brave-search
- Use **`/btw`** for side conversations — ask questions or plan ahead without interrupting the main task
