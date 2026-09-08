import assert from "node:assert/strict";
import test from "node:test";

import {
  findOperationalPromise,
  shellStartsDurableExecutor,
} from "./detector.mjs";

test("detects operational future-work promises", () => {
  assert.deepEqual(findOperationalPromise("I'll keep monitoring the build."), {
    phrase: "I'll keep monitoring",
    index: 0,
  });
  assert.ok(
    findOperationalPromise("I will check back after the deployment finishes."),
  );
  assert.ok(findOperationalPromise("I'm going to investigate the failure."));
});

test("does not detect explanatory prose or quoted examples", () => {
  assert.equal(
    findOperationalPromise("I'll explain how the endpoint works."),
    null,
  );
  assert.equal(
    findOperationalPromise(
      "Never say `I'll monitor the build` without an executor.",
    ),
    null,
  );
  assert.equal(findOperationalPromise("> I will deploy it later"), null);
});

test("recognises explicit-server tmux launches but not queries", () => {
  for (const command of [
    'tmux -S "$socket" split-window -d -t "%1" -- ./monitor.sh',
    "tmux -L 'test server' new-session -d ./monitor.sh",
    'tmux -f /tmp/config -S /tmp/socket new-window ./monitor.sh',
    "tmux split-window ./monitor.sh",
  ]) {
    assert.equal(shellStartsDurableExecutor(command), true, command);
  }
  for (const command of [
    'tmux -S "$socket" list-panes',
    'tmux -S "$socket" capture-pane -p -t "%1"',
    "tmux -L test show-options -g",
  ]) {
    assert.equal(shellStartsDurableExecutor(command), false, command);
  }
});

test("recognises shell forms that start a durable executor", () => {
  assert.equal(shellStartsDurableExecutor("sleep 10 && check"), false);
  assert.equal(
    shellStartsDurableExecutor("nohup ./poll-builds.sh >/tmp/poll.log 2>&1 &"),
    true,
  );
  assert.equal(
    shellStartsDurableExecutor("zellij action new-pane -- ./monitor.sh"),
    true,
  );
  assert.equal(
    shellStartsDurableExecutor("tmux new-window ./monitor.sh"),
    true,
  );
});
