const reportStepPattern = /^\s*-\s*\[(done|pending|blocked)\]\s+(.+?)\s*$/i;

export function parseReportStep(line) {
  const match = reportStepPattern.exec(line);
  if (!match) return undefined;

  const status = match[1].toLowerCase();
  const text = match[2];
  if (status === "blocked" && !/\([^()]+\)$/.test(text)) return undefined;

  return { status, text };
}
