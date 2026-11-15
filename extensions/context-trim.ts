/**
 * context-trim — applies tool toggles and tool-description overrides
 * from the pi-context-editor UI.
 *
 * Reads ~/.pi/context-editor/state.json:
 *   { "disabled_tools": ["name", ...],
 *     "lazy_tools": ["name", ...],
 *     "tool_overrides": { "name": "new model-facing description", ... } }
 *
 * - disabled_tools are removed from the active tool set on each agent start.
 * - lazy_tools stay active but their declarations are hidden from requests
 *   (0 context tokens); they remain callable from codemode scripts, where
 *   searchTools()/ALL_TOOLS acts as the registry.
 * - tool_overrides rewrite the description declared to the model.
 * Both lazy and overrides work via prepareLoadout on an always-active helper
 * tool whose own declaration is hidden from requests.
 *
 * Managed by ~/code/pi-context-editor/pi_context_editor.py (pi-context-ui).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface TrimState {
	disabled_tools?: string[];
	lazy_tools?: string[];
	tool_overrides?: Record<string, string>;
}

function readState(): TrimState {
	try {
		const statePath = join(homedir(), ".pi", "context-editor", "state.json");
		return JSON.parse(readFileSync(statePath, "utf-8"));
	} catch {
		return {};
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		const disabled = readState().disabled_tools ?? [];
		if (disabled.length === 0) return;
		const sel = event.systemPromptOptions?.selectedTools as unknown[] | undefined;
		if (!sel) return;
		for (let i = sel.length - 1; i >= 0; i--) {
			const entry = sel[i];
			const name = typeof entry === "string" ? entry : (entry as { name?: string }).name;
			if (name && disabled.includes(name)) sel.splice(i, 1);
		}
	});

	pi.registerTool({
		name: "context_trim",
		label: "Context trim",
		description: "Internal helper of the pi context editor. Do not call.",
		parameters: Type.Object({}),
		prepareLoadout: (loadout) => {
			const state = readState();
			const overrides = state.tool_overrides ?? {};
			const lazy = state.lazy_tools ?? [];
			const descriptions: Record<string, string> = {};
			const hidden: string[] = ["context_trim"];
			for (const t of loadout.declared) {
				if (overrides[t.name]) descriptions[t.name] = overrides[t.name];
				if (lazy.includes(t.name)) hidden.push(t.name);
			}
			return { descriptions, hiddenDeclarations: hidden };
		},
		async execute() {
			return { content: [{ type: "text", text: "noop" }] };
		},
	});
}
