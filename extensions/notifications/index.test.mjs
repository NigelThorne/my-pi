import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("macOS notifications use notify-me instead of osascript", () => {
  assert.match(source, /notify-me/);
  assert.doesNotMatch(source, /osascript/);
  assert.match(source, /--sound["'],\s*["']off/);
});
