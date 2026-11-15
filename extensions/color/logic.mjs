export const NAMED_COLORS = Object.freeze({
  blue: "#0057b8",
  green: "#16803c",
  orange: "#d76b00",
  pink: "#c42f79",
  purple: "#7147b8",
  red: "#c9362b",
  yellow: "#c99700",
});

export function parseColorArgument(input) {
  const value = input.trim().toLowerCase();
  if (!value) return { kind: "picker" };
  if (value === "off") return { kind: "off" };
  if (Object.hasOwn(NAMED_COLORS, value)) {
    return { kind: "color", hex: NAMED_COLORS[value], name: value };
  }
  if (/^#[0-9a-f]{6}$/.test(value)) return { kind: "color", hex: value, name: value };
  return { kind: "invalid" };
}

export function createBarComponent(theme, color) {
  return {
    invalidate() {},
    render(width) {
      if (width <= 0) return [""];
      return [theme.style(" ".repeat(width), { bg: color })];
    },
  };
}

function formatTokens(value) {
  if (!value) return "0";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
}

function sanitizeStatus(value) {
  return value.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function sessionUsage(ctx) {
  let input = 0;
  let output = 0;
  for (const entry of ctx.sessionManager?.getEntries?.() ?? []) {
    const usage = entry.type === "usage" ? entry.usage : entry.message?.usage ?? entry.usage;
    if (!usage) continue;
    input += usage.input ?? 0;
    output += usage.output ?? 0;
  }
  return { input, output };
}

export function renderFooterLines(width, theme, color, footerData, ctx, fit = (text) => text.slice(0, width)) {
  const bar = createBarComponent(theme, color).render(width)[0];
  if (width <= 0) return [bar];

  const branch = footerData.getGitBranch();
  const location = `${ctx.cwd}${branch ? ` (${branch})` : ""}`;
  const usage = sessionUsage(ctx);
  const context = ctx.getContextUsage?.();
  const details = [
    usage.input ? `↑${formatTokens(usage.input)}` : "",
    usage.output ? `↓${formatTokens(usage.output)}` : "",
    context?.percent != null ? `${context.percent.toFixed(1)}%` : "",
    ctx.model?.id ?? "no-model",
  ].filter(Boolean).join(" ");
  const gap = Math.max(1, width - location.length - details.length);
  const lines = [bar, fit(theme.fg("dim", `${location}${" ".repeat(gap)}${details}`), width, "")];

  const statuses = [...footerData.getExtensionStatuses().entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, text]) => sanitizeStatus(text));
  if (statuses.length) lines.push(fit(statuses.join(" "), width, ""));
  return lines;
}

export function installColorExtension(pi, { toColor, fit }) {
  let enabled = false;

  const restore = (ctx) => {
    if (!enabled || ctx.mode !== "tui") return;
    ctx.ui.setHeader(undefined);
    ctx.ui.setFooter(undefined);
    enabled = false;
  };

  pi.on("session_start", (_event, ctx) => restore(ctx));

  pi.registerCommand("color", {
    description: "Set one-cell colour bars at the top and bottom of the TUI",
    handler: async (rawArgument, ctx) => {
      let parsed = parseColorArgument(rawArgument);
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("Colour bars are available only in TUI mode", "warning");
        return;
      }

      if (parsed.kind === "picker") {
        const choice = await ctx.ui.select("Colour bars", [...Object.keys(NAMED_COLORS), "off"]);
        if (choice === undefined) return;
        parsed = parseColorArgument(choice);
      }

      if (parsed.kind === "invalid") {
        ctx.ui.notify(`Unknown colour. Use ${Object.keys(NAMED_COLORS).join(", ")}, #rrggbb, or off.`, "warning");
        return;
      }
      if (parsed.kind === "off") {
        const wasEnabled = enabled;
        if (wasEnabled) restore(ctx);
        ctx.ui.notify(wasEnabled ? "Colour bars disabled" : "Default header and footer already active", "info");
        return;
      }

      const color = toColor(parsed.hex);
      ctx.ui.setHeader((_tui, theme) => createBarComponent(theme, color));
      ctx.ui.setFooter((tui, theme, footerData) => {
        const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
        return {
          dispose: unsubscribe,
          invalidate() {},
          render: (width) => renderFooterLines(width, theme, color, footerData, ctx, fit),
        };
      });
      enabled = true;
      ctx.ui.notify(`Colour bars set to ${parsed.name}`, "info");
    },
  });
}
