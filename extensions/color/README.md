# Colour bars

`/color` adds a one-cell-high colour bar as Pi's header and another at the top of its footer.

## Commands

- `/color` opens the named-colour picker.
- `/color blue` sets a named colour. Available names are `blue`, `green`, `orange`, `pink`, `purple`, `red`, and `yellow`.
- `/color #1e90ff` accepts a six-digit RGB value.
- `/color off` restores Pi's built-in header and footer.

The colour applies only to the current TUI session. A new session or session switch resets it. Reloading the extension also resets it.

## Footer and header behaviour

The custom footer keeps the working directory, Git branch, token totals, context percentage, model name, and extension status text. It updates when the Git branch changes.

Pi does not export its built-in header as a component, so the colour bar replaces the built-in logo and key hints while enabled. Turning the bars off restores them. The extension does not change the header or footer until you choose a colour.

The command has no effect outside TUI mode. The bars do not handle keyboard input.

## Test

```sh
node --test extensions/color/index.test.mjs
```
