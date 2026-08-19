# Setup

Follow these steps to set up this pi instance.

## 1. Settings

Copy settings, keybindings, and global prompt:

```bash
mkdir -p ~/.pi/agent
cp ~/.my-pi/settings.example.json ~/.pi/agent/settings.json
cp ~/.my-pi/keybindings.json ~/.pi/agent/keybindings.json
cp ~/.my-pi/AGENTS.md ~/.pi/agent/AGENTS.md
```

If `~/.pi/agent/settings.json` already exists, merge in the `extensions`, `skills`, `prompts`, and `packages` arrays rather than overwriting. Keep runtime-only fields such as `lastChangelogVersion` local to `~/.pi/agent/settings.json`; do not commit them.

## 2. Agents

Subagent definitions are version-controlled in `~/.my-pi/agents/`. The interactive subagents extension reads them from there, so `~/.pi/agent/agents` should not be used as the source of truth.

For compatibility with older extension versions, you can still sync copies:

```bash
mkdir -p ~/.pi/agent/agents
cp ~/.my-pi/agents/*.md ~/.pi/agent/agents/
```

## 3. Web Tools Extension

Install dependencies for the web-tools extension (preferred for web search and fetching — no API key needed):

```bash
cd ~/.my-pi/extensions/web-tools && npm install
```

## 4. Skills

Install dependencies for the bundled skills:

```bash
cd ~/.my-pi/skills/browser-tools && npm install
cd ~/.my-pi/skills/brave-search && npm install   # optional legacy fallback
```

### Browser (for browser-tools)

**macOS:** Chrome is usually already installed. If not: `brew install --cask google-chrome`

**Linux:**
```bash
# Option 1: Chrome (recommended — works without snap)
wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i /tmp/chrome.deb
sudo apt-get install -f -y

# Option 2: Chromium (if snap is available)
sudo snap install chromium
```

The `browser-start.js` script auto-detects Chrome or Chromium on both macOS and Linux. On headless Linux (no DISPLAY), it runs in headless mode automatically.

## 5. Environment Variables (optional)

Only needed if using the legacy brave-search skill. Check if `BRAVE_API_KEY` is set:

```bash
echo $BRAVE_API_KEY
```

If not set and the user wants brave-search, ask for their key and add it to `~/.profile`:

```bash
export BRAVE_API_KEY="<key>"
```

> **Note:** The `websearch` and `webfetch` tools require no API keys — they are the preferred web access tools.

## 6. Superpowers

[Superpowers](https://github.com/obra/superpowers) skills are bundled in `~/.my-pi/skills/`. No separate installation needed — they're loaded automatically via the skills path in settings.

## 7. Extension Dependencies

Install npm dependencies for the code-ast extension:

```bash
cd ~/.my-pi/extensions/code-ast && npm install
```

## 8. Packages & Submodules

pi-context is included as a git submodule in `extensions/pi-context` (loaded automatically by the extensions folder).

**[pi-context](https://github.com/ttttmr/pi-context)** - Git-like context management for AI agents:
- `/context` - View token usage dashboard
- `/skill:context-management` - Enable the workflow with tools: `context_tag`, `context_log`, `context_checkout`

## 9. pi-interactive-subagents (submodule)

The pi-interactive-subagents package provides async subagent orchestration in multiplexer panes. It's included as a git submodule:

```bash
cd ~/.my-pi
git submodule update --init --recursive
```

No build step needed — it's loaded directly as a pi package via `settings.json`.

Requires a terminal multiplexer. Start pi inside one:

```bash
cmux pi
# or
tmux new -A -s pi 'pi'
# or
zellij --session pi   # then run: pi
```

Optionally force a backend: `export PI_SUBAGENT_MUX=cmux|tmux|zellij`

## 10. pi-remote (submodule)

The pi-remote package is included as a git submodule with Tailscale integration. Initialize and build it:

```bash
cd ~/.my-pi
git submodule update --init --recursive
cd extensions/pi-remote && npm install --ignore-scripts && npm run build --workspace @noahsaso/pi-remote
```

This fork automatically runs `tailscale serve` when starting a remote session, exposing it over HTTPS on a unique subpath (`/pi/{session-id}/?token=...`) with Tailscale's auto-provisioned TLS certificate. The serve route is cleaned up when the session exits.

Requires Tailscale to be installed and running on the machine.

## 11. Verify

Run `pi -p "list all available tools"` to confirm everything loaded.
