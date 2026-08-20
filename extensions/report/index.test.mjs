import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseReportStep } from "./report-format.mjs";

const extensionUrl = new URL("./index.ts", import.meta.url);
const source = await readFile(extensionUrl, "utf8");

test("/report runs an isolated report from a snapshot and provides a close command", () => {
  assert.equal(fs.existsSync(extensionUrl), true, "report extension should exist");

  assert.match(source, /registerCommand\("report"/, "report command should be registered");
  assert.match(source, /registerCommand\("report:clear"/, "report close command should be registered");
  assert.match(source, /buildSessionContext\(/, "report should snapshot Pi's compaction-aware session context");
  assert.match(source, /ctx\.sessionManager\.getEntries\(\)/, "report should snapshot all session entries");
  assert.match(source, /ctx\.sessionManager\.getLeafId\(\)/, "report should snapshot the active session leaf");
  assert.match(source, /new AbortController\(\)/, "report should be cancellable");
  assert.match(source, /signal: controller\.signal/, "report should pass cancellation to the model stream");
  assert.match(source, /baseUrl: auth\.baseUrl/, "report should preserve resolved provider base URLs");
  assert.match(source, /streamSimple\(/, "report should stream its isolated model request");
  assert.match(source, /setWidget\("report"/, "report should render in its own widget");
  assert.match(source, /Do not start new work/i);
  assert.match(source, /Return only a short Markdown task list/i);
  assert.match(source, /- \[done\]/);
  assert.match(source, /- \[pending\]/);
  assert.match(source, /- \[blocked\]/);
  assert.match(source, /✓/);
  assert.match(source, /○/);
  assert.match(source, /⊘/);
  assert.doesNotMatch(source, /Plan of attack:/);
  assert.doesNotMatch(source, /Where I am up to:/);
  assert.doesNotMatch(source, /pi\.sendUserMessage\(/, "report must not queue work into the main session");
});

test("parseReportStep accepts only tagged report tasks", () => {
  assert.deepEqual(parseReportStep("- [done] Added the status renderer"), {
    status: "done",
    text: "Added the status renderer",
  });
  assert.deepEqual(parseReportStep("- [PENDING] Run lint"), {
    status: "pending",
    text: "Run lint",
  });
  assert.deepEqual(parseReportStep("- [blocked] Deploy (waiting for approval)"), {
    status: "blocked",
    text: "Deploy (waiting for approval)",
  });
  assert.equal(parseReportStep("Plan of attack: run lint"), undefined);
  assert.equal(parseReportStep("- [active] Unrecognised status"), undefined);
  assert.equal(parseReportStep("- [blocked] Deploy"), undefined, "blocked steps must explain what they are waiting for");
});
