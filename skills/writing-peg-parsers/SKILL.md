---
name: writing-peg-parsers
description: Use when writing or debugging parsers with Zig Parslet, .peg grammars, .pegtx tree transforms, embedded grammar tests, or the peg_parse, peg_test and peg_transform commands.
---

# Writing PEG parsers

```text
document + .peg → peg_parse → capture tree + .pegtx → peg_transform → JSON
                     ↑
                  peg_test
```

This is the Zig Parslet dialect, not Ruby or Elixir syntax. Keep recognition in the grammar and data conversion in transforms.

## Locate the tools

Prefer installed `peg_parse`, `peg_test`, and `peg_transform`. Nigel's source checkout is `~/code/zig-parslet`; its binaries are in `zig-out/bin`. If missing, build there with `mise exec -- zig build -Doptimize=ReleaseSafe`. The checkout pins Zig 0.16.0. Do not use an unrelated `zig` on PATH.

Read the checkout's `README.md` and `SPEC.md` for the full contract. If neither commands nor checkout exist, ask for their location rather than guessing an installation source.

## Author and check

1. Define accepted syntax and final JSON shape. Decide whitespace, empty input, duplicate keys, encoding and numeric precision explicitly.
2. Write valid and rejection tests. Use `@test(rule) "name" { ... }` for a helper, or plain `@test "name" { ... }` for the root. Both consume the whole test input. `expect` asserts the **raw capture tree**, not transformed output.
3. Implement one rule at a time. Run `peg_test grammar.peg` and inspect actual trees with `peg_parse` before designing transforms.
4. Add `.pegtx` rules. Test final JSON separately, including zero, one and multiple items, nested containers and malformed input.

## Keep rules small

Prefer a document rule that reads as a sequence of named parts, not one giant expression. Factor repeated headers, delimiters, whitespace and token patterns into helpers. Use meaningful names such as `subject`, `identifier`, `eols` and `serial_number`.

Keep lexical helpers uncaptured; capture fields in their semantic rules:

```peg
root document
document <- "Serial: " serial_number eols
serial_number <- serial_number:identifier
identifier <- [A-Z0-9]+ ("-" [A-Z0-9]+)*
eols <- ("\n" " "*)+
```

This `eols` accepts LF endings followed by spaces. Choose LF/CRLF and tab handling deliberately. Use `@test(identifier)`, `@test(eols)` and `@test(serial_number)` to isolate failures. Refactoring must preserve accepted input and capture trees; rerun both helper and document tests. Multiline wrapping improves readability, but does not replace factoring out duplication.

See [reference.md](reference.md) for syntax, capture shapes and transform traps. Adapt the runnable [example.peg](example.peg) and [example.pegtx](example.pegtx). They parse newline-terminated integer assignments into an object.

```sh
# Run from this skill directory; substitute absolute binary paths if needed.
peg_test example.peg
set -o pipefail
printf 'apples=12\npears=3\n' |
  peg_parse example.peg |
  peg_transform example.pegtx
# {"apples":12,"pears":3}
```

For arbitrary projects, save grammars and transforms in that project, not in this skill directory.

## Guard only real overlaps

Do not automatically guard every capture. First choose a field matcher that stops naturally at its delimiter. Digits stop before `&`; identifiers stop before `?`; a line matcher stops before a newline.

Add negative lookahead only if the field matcher can consume the delimiter or its leading bytes. Use the shortest unambiguous boundary, never a copy of the remaining document. Keep the following structure outside the capture. See [guard examples](reference.md#minimal-boundary-guards) and the tested [guards.peg](guards.peg).

## Diagnose failures

```sh
peg_test grammar.peg failing-input.txt
printf 'bad input' | peg_test grammar.peg -
```

This shows document and grammar locations plus bounded rule attempts. Successful attempts may later backtrack. JSON offsets and human columns count bytes, not Unicode characters.

| Symptom | Check |
| --- | --- |
| Longer alternative fails | Ordered choice commits to the first success; put longer overlapping literals first. |
| Captured field disappears | Repeated names overwrite in sequences; captured items need repetition/wrappers. |
| Single item has wrong shape | Assert zero/one/many trees, then match their actual shapes. |
| Transform silently does nothing | Exact object keys, bottom-up child changes, and rule order. |
| Missing closing delimiter has a misleading error | Guard an empty alternative with closing-delimiter lookahead, e.g. `empty:&"]"`. |

## CLI boundaries

Normal parse/transform stdout is bare JSON; errors go to stderr. `--json` puts structured errors on stdout, so never pipe those reports into transforms. Enable `pipefail` for pipelines.

Exit codes: `0` success, `1` document/test/runtime-transform failure, `2` usage/definition/file/input-JSON error. `peg_parse` skips balanced test blocks; it does not run assertions. An empty test suite passes, so confirm the reported count.
