/**
 * Clipboard Extension — Read/write system clipboard
 *
 * Supports:
 *   macOS  — pbpaste / pbcopy
 *   Linux  — xclip, xsel, or wl-copy/wl-paste (Wayland)
 *
 * Tools:
 *   clipboard_read  — Read current clipboard contents
 *   clipboard_write — Write text to clipboard
 *
 * Skips registration entirely on unsupported platforms.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { execSync } from "node:child_process";
import { platform } from "node:os";

function which(cmd: string): boolean {
	try {
		execSync(`which ${cmd}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function detectClipboard(): { read: string[]; write: string[] } | null {
	const os = platform();

	if (os === "darwin") {
		return { read: ["pbpaste"], write: ["pbcopy"] };
	}

	if (os === "linux") {
		// Wayland
		if (process.env.WAYLAND_DISPLAY) {
			if (which("wl-paste") && which("wl-copy")) {
				return { read: ["wl-paste", "--no-newline"], write: ["wl-copy"] };
			}
		}
		// X11 / fallback
		if (which("xclip")) {
			return {
				read: ["xclip", "-selection", "clipboard", "-o"],
				write: ["xclip", "-selection", "clipboard"],
			};
		}
		if (which("xsel")) {
			return {
				read: ["xsel", "--clipboard", "--output"],
				write: ["xsel", "--clipboard", "--input"],
			};
		}
	}

	return null;
}

export default function (pi: ExtensionAPI) {
	const clip = detectClipboard();

	if (!clip) {
		// No clipboard support — don't register tools
		return;
	}

	const readCmd = clip.read[0];
	const readArgs = clip.read.slice(1);
	const writeCmd = clip.write[0];
	const writeArgs = clip.write.slice(1);

	// --- clipboard_read ---
	pi.registerTool({
		name: "clipboard_read",
		label: "Read Clipboard",
		description: "Read the contents of the system clipboard. Returns clipboard contents as text.",
		parameters: Type.Object({}),

		async execute() {
			try {
				const result = await pi.exec(readCmd, readArgs);
				const raw = result.stdout;
				const truncation = truncateHead(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
				const text = truncation.truncated
					? `[Clipboard content truncated — showing first portion of ${formatSize(Buffer.byteLength(truncation.content, "utf-8"))} of ${formatSize(Buffer.byteLength(raw, "utf-8"))}]\n\n${truncation.content}`
					: raw;

				return {
					content: [{ type: "text", text: text || "(clipboard is empty)" }],
					details: undefined,
				};
			} catch (err: any) {
				throw new Error(`Failed to read clipboard: ${err.message}`);
			}
		},

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("clipboard_read")), 0, 0);
		},

		renderResult(result, _opts, theme, context) {
			if (context.isError) {
				const text = result.content[0];
				return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
			}
			const text = result.content[0];
			const content = text?.type === "text" ? text.text : "";
			const lines = content.split("\n").length;
			const size = Buffer.byteLength(content, "utf-8");
			return new Text(
				theme.fg("success", "✓ ") + theme.fg("muted", `${lines} line(s), ${formatSize(size)}`),
				0,
				0,
			);
		},
	});

	// --- clipboard_write ---
	pi.registerTool({
		name: "clipboard_write",
		label: "Write Clipboard",
		description: "Write text to the system clipboard.",
		parameters: Type.Object({
			text: Type.String({ description: "Text to write to the clipboard" }),
		}),

		async execute(_toolCallId, params: { text: string }) {
			try {
				execSync([writeCmd, ...writeArgs].join(" "), { input: params.text });
				const size = Buffer.byteLength(params.text, "utf-8");
				return {
					content: [{ type: "text", text: `Wrote ${formatSize(size)} to clipboard.` }],
					details: undefined,
				};
			} catch (err: any) {
				throw new Error(`Failed to write clipboard: ${err.message}`);
			}
		},

		renderCall(args, theme) {
			const preview = args.text?.length > 60 ? args.text.slice(0, 57) + "..." : args.text ?? "";
			return new Text(
				theme.fg("toolTitle", theme.bold("clipboard_write ")) + theme.fg("muted", preview),
				0,
				0,
			);
		},

		renderResult(result, _opts, theme, context) {
			if (context.isError) {
				const text = result.content[0];
				return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
			}
			const text = result.content[0];
			return new Text(theme.fg("success", "✓ ") + theme.fg("muted", text?.type === "text" ? text.text : ""), 0, 0);
		},
	});
}
