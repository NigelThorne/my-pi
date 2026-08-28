---
name: file-outliner
description: Use when exploring unfamiliar or large code/config files and you want structure before full reads. Prefer this instead of reading entire files when you need to find functions, classes, modules, headings, or relevant sections quickly.
---

# File Outliner

Explore files like a fully-folded editor. See structure first, then drill into the code you need — saving tokens by not reading entire files.

## Setup

First-time setup (only needed once):

```bash
cd /Users/nigelthorne/code/file_outliner && npm install && npm run build
chmod +x /Users/nigelthorne/code/file_outliner/file-outliner
ln -sf /Users/nigelthorne/code/file_outliner/file-outliner /Users/nigelthorne/.local/bin/file-outliner
```

## Commands

All commands use the PATH-installed wrapper:
```bash
file-outliner <command> <args>
```

### 1. `outline` — see the full structure (collapsed)

```bash
file-outliner outline <file> [<file>...]
```

Output shows foldable blocks with block IDs such as `b1`, `b2`, and `b10`. Block IDs are always prefixed with `b` so they cannot be confused with line numbers. `▶` means it has children you can expand.

Example:
```
src/parser.ts (112 lines)

· [b1] [imports] (3 statements, lines 1-3)  (L1-3, 3 lines)
· [b2] interface Config  (L5-9, 5 lines)
▶ [b5] export class Parser  (L11-95, 85 lines)
· [b6] export function create(...)  (L97-99, 3 lines)
```

### 2. `expand` — drill into blocks (show children)

```bash
file-outliner expand <file> <block-id|range> [<block-id|range>...] [<file> <block-id|range>...]
```

Opens the specified blocks to reveal their children. Ancestors auto-expand. You can repeat file/id groups to expand blocks across multiple files in one call. Inclusive ranges work too: `b1-23` is equivalent to `b1 b2 ... b23`. Ranges can appear alongside individual IDs and in repeated multi-file groups. One range may contain at most 10,000 block IDs.

Example:
```
▼ [b5] export class Parser  (L11-95, 85 lines)
  · [b3] constructor(...)  (L12-18, 7 lines)
  · [b4] parse(...)  (L20-45, 26 lines)
  · [b7] render(...)  (L47-92, 46 lines)
```

Range examples:
```bash
file-outliner expand file.ts b3 b7-12
file-outliner expand file1.ts b3 b8-10 file2.ts b4 b9-12
```

### 3. `show` — read the actual source code of a block

```bash
file-outliner show <file> <block-id|range> [<block-id|range>...] [<file> <block-id|range>...]
```

Displays full source with line numbers for the specified blocks. You can repeat file/id groups to show blocks across multiple files in one call. Inclusive ranges work too: `b1-23` is equivalent to `b1 b2 ... b23`. Ranges can appear alongside individual IDs and in repeated multi-file groups. One range may contain at most 10,000 block IDs.

Example:
```
  [b3] constructor(...)  (L12-18)
  ────────────────────────────────────────────────────────────
    12│   constructor(config: Config) {
    13│     this.config = config;
    14│     this.cache = new Map();
    15│   }
  ────────────────────────────────────────────────────────────
```

Range example:
```bash
file-outliner show <file> b1-23 b99-102
```

### 4. `lines` — read raw line range

```bash
file-outliner lines <file> <start> <end>
```

## Recommended Workflow

1. **`outline`** the file — get the full structure in minimal tokens
2. **`expand`** blocks that look relevant using `b`-prefixed block IDs — see what's inside classes/modules
3. **`show`** the specific function or block you need using `b`-prefixed block IDs — read only that code
4. Use **`lines`** when you need a specific range not aligned to blocks

This is much more token-efficient than reading an entire file when you only need to understand its structure or read specific parts.

## Supported File Types

- JavaScript: `.js` `.jsx` `.mjs` `.cjs`
- TypeScript: `.ts` `.tsx`
- Elixir: `.ex` `.exs`
- Markdown: `.md` `.markdown`
- Python: `.py`
- Go: `.go`
- Rust: `.rs`
- Java: `.java`
- Kotlin: `.kt` `.kts`
- Scala: `.scala` `.sc`
- PHP: `.php`
- Lua: `.lua`
- CSS: `.css`
- JSON: `.json`
- YAML: `.yaml` `.yml`

## Tips

- Block IDs are stable for a given file and always look like `b1`, `b2`, `b10` — you can reference them across multiple commands
- Outline multiple files at once: `outline file1.ts file2.ts file3.js`
- Expand multiple blocks or ranges at once: `expand file.ts b3 b7 b12-15`
- Expand blocks across files: `expand file1.ts b3 b8-10 file2.ts b4 b8`
- Show multiple blocks or ranges at once: `show file.ts b3 b7 b12-15` to compare functions side-by-side
- Show blocks across files: `show file1.ts b3 b8-10 file2.ts b4 b8`
- The `▶` marker means a block has children worth expanding
- The `·` marker means it's a leaf block — use `show` to read its content
- Multi-file `outline` prints a filename header before each file and reports per-file errors clearly
