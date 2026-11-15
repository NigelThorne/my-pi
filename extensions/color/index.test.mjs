import assert from "node:assert/strict";
import test from "node:test";

import {
  NAMED_COLORS,
  createBarComponent,
  installColorExtension,
  parseColorArgument,
  renderFooterLines,
} from "./logic.mjs";

test("parses named colours, hex colours, off, and invalid input", () => {
  assert.deepEqual(parseColorArgument("blue"), { kind: "color", hex: NAMED_COLORS.blue, name: "blue" });
  assert.deepEqual(parseColorArgument(" #A1b2C3 "), { kind: "color", hex: "#a1b2c3", name: "#a1b2c3" });
  assert.deepEqual(parseColorArgument("OFF"), { kind: "off" });
  assert.deepEqual(parseColorArgument(""), { kind: "picker" });
  assert.deepEqual(parseColorArgument("chartreuse"), { kind: "invalid" });
  assert.deepEqual(parseColorArgument("#123"), { kind: "invalid" });
});

test("bar is exactly one line and respects zero and narrow widths", () => {
  const theme = { style: (text, options) => `[${options.bg}]${text}[/]` };
  const bar = createBarComponent(theme, "#0057b8");

  assert.deepEqual(bar.render(0), [""]);
  assert.deepEqual(bar.render(1), ["[#0057b8] [/]"]);
  assert.deepEqual(bar.render(4), ["[#0057b8]    [/]"]);
  assert.equal("handleInput" in bar, false, "display-only bars must not intercept input");
});

test("command handles picker cancellation, off, no-TUI mode, and session reset", async () => {
  const commands = new Map();
  const events = new Map();
  installColorExtension({
    registerCommand: (name, command) => commands.set(name, command),
    on: (name, handler) => events.set(name, handler),
  }, { toColor: (hex) => hex, fit: (text, width) => text.slice(0, width) });

  const calls = [];
  const ctx = {
    mode: "tui",
    cwd: "/tmp",
    model: { id: "model" },
    sessionManager: { getEntries: () => [] },
    getContextUsage: () => undefined,
    ui: {
      select: async () => undefined,
      notify: (...args) => calls.push(["notify", ...args]),
      setHeader: (factory) => calls.push(["header", factory]),
      setFooter: (factory) => calls.push(["footer", factory]),
    },
  };

  await commands.get("color").handler("", ctx);
  assert.deepEqual(calls, [], "cancelling the picker must not alter UI");

  await commands.get("color").handler("blue", ctx);
  assert.equal(typeof calls.find(([kind]) => kind === "header")[1], "function");
  assert.equal(typeof calls.find(([kind]) => kind === "footer")[1], "function");

  calls.length = 0;
  await commands.get("color").handler("off", ctx);
  assert.deepEqual(calls.slice(0, 2), [["header", undefined], ["footer", undefined]]);

  calls.length = 0;
  const nonTui = { ...ctx, mode: "rpc" };
  await commands.get("color").handler("red", nonTui);
  assert.equal(calls.some(([kind]) => kind === "header" || kind === "footer"), false);

  await commands.get("color").handler("green", ctx);
  calls.length = 0;
  events.get("session_start")({}, ctx);
  assert.deepEqual(calls, [["header", undefined], ["footer", undefined]]);
});

test("footer keeps useful default-style session details and statuses below the bar", () => {
  const theme = {
    style: (text, options) => `[${options.bg}]${text}[/]`,
    fg: (_token, text) => text,
  };
  const footerData = {
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map([["z", "working\nnow"], ["a", "ready"]]),
  };
  const ctx = {
    cwd: "/tmp/project",
    model: { id: "gpt-test" },
    getContextUsage: () => ({ percent: 42.4 }),
  };

  const lines = renderFooterLines(80, theme, "#0057b8", footerData, ctx);
  assert.equal(lines[0], `[#0057b8]${" ".repeat(80)}[/]`);
  assert.match(lines[1], /\/tmp\/project \(main\)/);
  assert.match(lines[1], /42\.4%/);
  assert.match(lines[1], /gpt-test/);
  assert.equal(lines[2], "ready working now");
  assert.ok(lines.every((line) => line.replace(/\[[^\]]+\]|\[\/\]/g, "").length <= 80));
});
