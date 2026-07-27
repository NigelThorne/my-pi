import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./btw.ts", import.meta.url), "utf8");

test("btw resolves request auth through the current pi model registry API", () => {
  assert.match(source, /ctx\.modelRegistry\.getApiKeyAndHeaders\(model\)/);
  assert.doesNotMatch(source, /ctx\.modelRegistry\.getApiKey\(model\)/);
});

test("btw forwards pi's resolved auth metadata to model calls", () => {
  assert.match(source, /apiKey: auth\.apiKey,\s*headers: auth\.headers,\s*env: auth\.env,/s);
});
