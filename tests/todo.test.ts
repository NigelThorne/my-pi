import { describe, expect, mock, test } from "bun:test";

mock.module("@mariozechner/pi-tui", () => ({
	matchesKey: () => false,
	Text: class Text {
		constructor(public text: string, public x: number, public y: number) {}
	},
	truncateToWidth: (s: string) => s,
}));

mock.module("@mariozechner/pi-ai", () => ({
	StringEnum: (values: readonly string[]) => ({ enum: values }),
}));

mock.module("typebox", () => {
	const Type = {
		Object: (properties: unknown, options?: unknown) => ({ type: "object", properties, ...((options as object) ?? {}) }),
		Array: (items: unknown, options?: unknown) => ({ type: "array", items, ...((options as object) ?? {}) }),
		Number: (options?: unknown) => ({ type: "number", ...((options as object) ?? {}) }),
		String: (options?: unknown) => ({ type: "string", ...((options as object) ?? {}) }),
		Optional: (schema: unknown) => schema,
	};
	return { Type };
});

async function setupTodoTools() {
	const { default: todoExtension } = await import("../extensions/todo");
	const tools = new Map<string, any>();
	const pi = {
		on() {},
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
	};
	todoExtension(pi as any);
	return tools;
}

describe("todo_remove", () => {
	test("removes explicitly listed indices and ranges, then rewrites dependencies", async () => {
		const tools = await setupTodoTools();
		await tools.get("todo_add").execute("add", {
			items: [
				{ text: "A" },
				{ text: "B" },
				{ text: "C", depends: [1, 2] },
				{ text: "D", depends: [3] },
				{ text: "E" },
			],
		});

		const result = await tools.get("todo_remove").execute("remove", {
			indices: [2],
			range: "4-5",
		});

		expect(result.content[0].text).toBe('Removed 3 item(s): 2. "B", 4. "D", 5. "E". 2 remaining.');
		expect(result.details.items).toEqual([
			{ text: "A", done: false, depends: [] },
			{ text: "C", done: false, depends: [1] },
		]);
	});
});
