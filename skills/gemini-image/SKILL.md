---
name: gemini-image
description: Use when asked to generate an image, illustration, wallpaper, or visual asset with Gemini or Nano Banana, or when replacing the unavailable generate_image tool.
---

# Gemini images

Generate PNG images using the saved Gemini website login. No paid API fallback. This replaces the disabled Antigravity `generate_image` tool; it is a skill with a shell helper, not another Pi tool.

Requires macOS, `uv`, and a saved login in macOS Keychain. Install the pinned dependencies once:

```bash
uv sync --locked --project ~/.my-pi/skills/gemini-image
```

The helper uses that isolated Python environment and never installs packages during generation. Execute `scripts/gemini-image`; resolve its path relative to this skill directory, not the current project.

## Generate

Use a new output filename. The helper refuses to overwrite an existing file.

```bash
~/.my-pi/skills/gemini-image/scripts/gemini-image generate \
  --prompt 'A red panda astronaut holding a sign reading HELLO NIGEL, storybook illustration' \
  --output /tmp/red-panda-astronaut.png \
  --aspect-ratio 1:1
```

Describe the subject, style, composition, and exact lettering in the prompt. Aspect ratio is a request to Gemini, not a guarantee of exact dimensions. Model access and quota follow the saved account's Gemini website access.

On success, use Pi's `read` tool on the returned PNG path to inspect the image and lettering. Link the file in the response. Do not execute an image path as a shell command. Do not open a desktop app unless the user asks.

An image-generation request sends the prompt to Google. Follow the current user's authorization; do not upload confidential material or run extra generations without approval. Do not loop on quota, timeout, or no-image errors. A timed-out request may still have used quota.

## Login and recovery

```bash
~/.my-pi/skills/gemini-image/scripts/gemini-image status
~/.my-pi/skills/gemini-image/scripts/gemini-image auth --help
```

`status` describes locally saved credentials, not proof that the server accepts them. Normal generation uses Keychain only, without browser access.

If the login is missing or expired, ask for permission before accessing Chrome. Read the `chrome-cdp` skill, identify the intended Gemini tab, and require its explicit target ID and account email. Then run:

```bash
~/.my-pi/skills/gemini-image/scripts/gemini-image auth --target TARGET_ID --account ACCOUNT_EMAIL
```

The helper verifies the tab's account and imports only the needed cookies into Keychain. Never ask the user to paste cookies into chat. Do not print cookies, use cookie values in shell arguments, inspect other browser profiles, or fall back to browser-cookie discovery. If Keychain is locked or access is denied, report the error rather than bypassing it.

To remove this helper's saved login without signing out of Chrome:

```bash
~/.my-pi/skills/gemini-image/scripts/gemini-image logout
```

For command-specific flags, run `scripts/gemini-image COMMAND --help`. This is an unofficial web wrapper; Google changes may break it. Report failure rather than switching providers or changing billing.
