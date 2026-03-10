# Setup

Follow these steps to set up this pi instance.

## 1. Settings

Copy settings and global prompt:

```bash
mkdir -p ~/.pi/agent
cp ~/.my-pi/settings.example.json ~/.pi/agent/settings.json
cp ~/.my-pi/AGENTS.md ~/.pi/agent/AGENTS.md
```

If `~/.pi/agent/settings.json` already exists, merge in the `extensions` and `skills` arrays rather than overwriting.

## 2. Agents

Copy subagent definitions:

```bash
mkdir -p ~/.pi/agent/agents
cp ~/.my-pi/agents/*.md ~/.pi/agent/agents/
```

## 3. Skills

Install dependencies for the bundled skills (brave-search + browser-tools):

```bash
cd ~/.my-pi/skills/brave-search && npm install
cd ~/.my-pi/skills/browser-tools && npm install
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

## 4. Environment Variables

Check if `BRAVE_API_KEY` is set:

```bash
echo $BRAVE_API_KEY
```

If not set, ask the user for their key and add it to `~/.profile`:

```bash
export BRAVE_API_KEY="<key>"
```

## 5. Superpowers

[Superpowers](https://github.com/obra/superpowers) skills are bundled in `~/.my-pi/skills/`. No separate installation needed — they're loaded automatically via the skills path in settings.

## 6. Extension Dependencies

Install npm dependencies for the code-ast extension:

```bash
cd ~/.my-pi/extensions/code-ast && npm install
```

## 7. Packages

Install npm packages listed in settings.json:

```bash
pi install npm:pi-context
pi install npm:@q.roy/pi-remote
```

**[pi-context](https://github.com/ttttmr/pi-context)** - Git-like context management for AI agents:
- `/context` - View token usage dashboard
- `/skill:context-management` - Enable the workflow with tools: `context_tag`, `context_log`, `context_checkout`

**[@q.roy/pi-remote](https://github.com/ruanqisevik/pi-mono-extensions)** - Remote terminal access for pi via WebSocket and browser

## 8. Verify

Run `pi -p "list all available tools"` to confirm everything loaded.
