/**
 * Detect first-person future-work claims that require an already-running executor.
 *
 * This deliberately targets operational promises, not conversational phrases such
 * as "I'll explain". The guard can repair a missed task, but should not turn
 * normal discussion into an agent loop.
 */
const OPERATIONAL_VERBS = [
  "check",
  "checking",
  "monitor",
  "monitoring",
  "watch",
  "watching",
  "follow up",
  "follow-up",
  "get back",
  "come back",
  "look into",
  "investigate",
  "fix",
  "implement",
  "run",
  "start",
  "continue",
  "retry",
  "work on",
  "handle",
  "push",
  "deploy",
  "verify",
  "test",
];

const FUTURE_PREFIX = String.raw`(?:i(?:'|’)ll|i\s+will|i(?:'|’)m\s+going\s+to|i\s+am\s+going\s+to)`;
const OPERATIONAL_PROMISE = new RegExp(
  String.raw`\b${FUTURE_PREFIX}\s+(?:keep\s+)?(?:${OPERATIONAL_VERBS.map((verb) => verb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\b`,
  "i",
);

function stripQuotedAndCodeText(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^\s*>.*$/gm, " ");
}

export function findOperationalPromise(text) {
  const prose = stripQuotedAndCodeText(String(text ?? ""));
  const match = prose.match(OPERATIONAL_PROMISE);
  if (!match || match.index === undefined) return null;

  const before = prose.slice(Math.max(0, match.index - 48), match.index);
  if (
    /\b(?:never|don['’]t|do not|cannot|can['’]t|shouldn['’]t)\s*$/i.test(before)
  ) {
    return null;
  }

  return {
    phrase: match[0],
    index: match.index,
  };
}

export function shellStartsDurableExecutor(command) {
  const value = String(command ?? "");
  return /\b(?:nohup|disown|setsid)\b|\b(?:tmux\s+(?:new-session|new-window)|zellij\s+action\s+new-pane)\b|(?<!&)&(?!&)/.test(
    value,
  );
}
