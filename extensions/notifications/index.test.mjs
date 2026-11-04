import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { notificationArgs, reconnectLink, sendMacNotification, validateNotificationLink } from "./notification-link.mjs";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("macOS notifications use notify-me instead of osascript", () => {
  assert.match(source, /notify-me/);
  assert.doesNotMatch(source, /osascript/);
  assert.match(source, /sendMacNotification/);
});

test("explicit links are validated and forwarded to notify-me", () => {
  const calls = [];
  sendMacNotification((binary, args) => calls.push({ binary, args }), "/mock/notify-me", "Pi worker: done", "pi", "https://example.com/result");
  assert.deepEqual(calls, [{
    binary: "/mock/notify-me",
    args: ["--title", "pi", "--message", "Pi worker: done", "--sound", "off", "--link", "https://example.com/result"],
  }]);
});

test("default reconnect link encodes the current session id on each execution", () => {
  let current = "session one";
  const currentLink = () => reconnectLink(current);
  assert.equal(currentLink(), "pisessionmanager://session/session%20one/reconnect");
  current = "session/two";
  assert.equal(currentLink(), "pisessionmanager://session/session%2Ftwo/reconnect");
});

test("unsafe and malformed overrides fail before notification execution", () => {
  for (const link of ["", "javascript:alert(1)", "data:text/plain,no", "file:///tmp/no", "not a url"]) {
    assert.throws(() => validateNotificationLink(link));
  }
});

test("no-link notification arguments retain existing notify-me behavior", () => {
  assert.deepEqual(notificationArgs("Pi worker: done", "pi"), ["--title", "pi", "--message", "Pi worker: done", "--sound", "off"]);
});

test("Linux path refuses link support rather than silently dropping it", () => {
  assert.match(source, /notification links are not supported by notify-send/);
});
