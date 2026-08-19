import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const extensionUrl = new URL("./index.ts", import.meta.url);

test("/report asks for a concise bullet-point status without starting new work", async () => {
  assert.equal(fs.existsSync(extensionUrl), true, "report extension should exist");

  const { default: registerReport } = await import(extensionUrl.href);
  const commands = new Map();
  const sentMessages = [];
  const notifications = [];

  registerReport({
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    sendUserMessage(message, options) {
      sentMessages.push({ message, options });
    },
  });

  const report = commands.get("report");
  assert.ok(report, "report command should be registered");

  await report.handler("", {
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].message, /Do not start new work/i);
  assert.match(sentMessages[0].message, /- Plan of attack:/);
  assert.match(sentMessages[0].message, /- Where I am up to:/);
  assert.deepEqual(sentMessages[0].options, { deliverAs: "followUp" });
  assert.deepEqual(notifications, [{ message: "Report prompt sent.", type: "info" }]);
});
