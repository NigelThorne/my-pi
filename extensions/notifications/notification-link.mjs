const SUPPORTED_PROTOCOLS = new Set(["http:", "https:", "pisessionmanager:"]);

export function validateNotificationLink(value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error("link must be a non-empty string");
  const link = value.trim();
  let parsed;
  try { parsed = new URL(link); } catch { throw new Error("link must be a valid URL"); }
  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) throw new Error("link scheme must be http, https, or pisessionmanager");
  if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.hostname) throw new Error("link must include a host");
  return link;
}

export function reconnectLink(sessionId) {
  if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("current session id is unavailable");
  return `pisessionmanager://session/${encodeURIComponent(sessionId)}/reconnect`;
}

export function notificationArgs(message, title, link) {
  const args = ["--title", title, "--message", message, "--sound", "off"];
  if (link) args.push("--link", validateNotificationLink(link));
  return args;
}

export function sendMacNotification(execFile, binary, message, title, link) {
  execFile(binary, notificationArgs(message, title, link));
}
