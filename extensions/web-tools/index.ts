/**
 * Web Tools Extension — webfetch and websearch tools for pi
 *
 * Inspired by opencode's built-in web tools.
 *
 * Tools:
 *   webfetch  — Fetch and read web page content (URL → markdown/text/html)
 *   websearch — Search the web via Exa AI (no API key required)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

// --- Constants ---

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30_000; // 30s
const MAX_TIMEOUT = 120_000; // 2min

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const DEFAULT_NUM_RESULTS = 8;

// --- Helpers ---

function convertHtmlToMarkdown(html: string): string {
	const turndown = new TurndownService({ headingStyle: "atx", hr: "---", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*" });
	turndown.use(gfm);
	turndown.remove(["script", "style", "meta", "link", "noscript"]);
	turndown.addRule("removeEmptyLinks", {
		filter: (node: any) => node.nodeName === "A" && !node.textContent?.trim(),
		replacement: () => "",
	});
	return turndown
		.turndown(html)
		.replace(/\[\\?\[\s*\\?\]\]\([^)]*\)/g, "")
		.replace(/ +/g, " ")
		.replace(/\s+,/g, ",")
		.replace(/\s+\./g, ".")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function extractReadableContent(html: string, url: string): { title?: string; content: string } | null {
	try {
		const dom = new JSDOM(html, { url });
		const reader = new Readability(dom.window.document);
		const article = reader.parse();
		if (article?.content) {
			return { title: article.title || undefined, content: article.content };
		}
	} catch {}
	return null;
}

function extractTextFromHtml(html: string): string {
	const dom = new JSDOM(html);
	const doc = dom.window.document;
	doc.querySelectorAll("script, style, noscript, iframe, object, embed").forEach((el: any) => el.remove());
	const main = doc.querySelector("main, article, [role='main'], .content, #content") || doc.body;
	return main?.textContent?.trim() || "";
}

function truncateOutput(text: string): string {
	const truncation = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	if (truncation.truncated) {
		return truncation.content + `\n\n[Output truncated: showing ${formatSize(Buffer.byteLength(truncation.content, "utf-8"))} of ${formatSize(Buffer.byteLength(text, "utf-8"))}]`;
	}
	return text;
}

// --- Extension ---

export default function (pi: ExtensionAPI) {
	// ========== webfetch ==========
	pi.registerTool({
		name: "webfetch",
		label: "Web Fetch",
		description: [
			"Fetch content from a URL and return it as markdown, text, or HTML.",
			"- URL must start with http:// or https://",
			"- Format options: 'markdown' (default), 'text', or 'html'",
			"- Converts HTML to clean readable markdown by default",
			"- Use for reading documentation, articles, web pages",
			"- Results may be truncated if the content is very large",
			"- Optional timeout in seconds (default 30, max 120)",
		].join("\n"),
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch content from" }),
			format: Type.Optional(
				StringEnum(["markdown", "text", "html"] as const, {
					description: "Output format: 'markdown' (default), 'text', or 'html'",
				}),
			),
			timeout: Type.Optional(
				Type.Number({ description: "Timeout in seconds (default 30, max 120)" }),
			),
		}),

		async execute(_toolCallId, params: { url: string; format?: string; timeout?: number }, signal) {
			const url = params.url;
			const format = params.format || "markdown";

			// Validate URL
			if (!url.startsWith("http://") && !url.startsWith("https://")) {
				throw new Error("URL must start with http:// or https://");
			}

			const timeout = Math.min((params.timeout ?? 30) * 1000, MAX_TIMEOUT);

			try {
				// Build Accept header based on format
				let acceptHeader: string;
				switch (format) {
					case "markdown":
						acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
						break;
					case "text":
						acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
						break;
					case "html":
						acceptHeader = "text/html;q=1.0, application/xhtml+xml;q=0.9, */*;q=0.1";
						break;
					default:
						acceptHeader = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
				}

				const headers: Record<string, string> = {
					"User-Agent": USER_AGENT,
					Accept: acceptHeader,
					"Accept-Language": "en-US,en;q=0.9",
				};

				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeout);

				// Abort if parent signal fires
				if (signal) {
					signal.addEventListener("abort", () => controller.abort(), { once: true });
				}

				let response: Response;
				try {
					const initial = await fetch(url, { signal: controller.signal, headers });

					// Retry with honest UA if Cloudflare blocks
					if (initial.status === 403 && initial.headers.get("cf-mitigated") === "challenge") {
						response = await fetch(url, {
							signal: controller.signal,
							headers: { ...headers, "User-Agent": "pi-coding-agent" },
						});
					} else {
						response = initial;
					}
				} finally {
					clearTimeout(timeoutId);
				}

				if (!response.ok) {
					throw new Error(`HTTP ${response.status} ${response.statusText}`);
				}

				// Check content size
				const contentLength = response.headers.get("content-length");
				if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
					throw new Error("Response too large (exceeds 5MB limit)");
				}

				const arrayBuffer = await response.arrayBuffer();
				if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
					throw new Error("Response too large (exceeds 5MB limit)");
				}

				const contentType = response.headers.get("content-type") || "";
				const isHtml = contentType.includes("text/html");
				const raw = new TextDecoder().decode(arrayBuffer);

				let output: string;

				switch (format) {
					case "markdown":
						if (isHtml) {
							const article = extractReadableContent(raw, url);
							if (article) {
								const md = convertHtmlToMarkdown(article.content);
								output = article.title ? `# ${article.title}\n\n${md}` : md;
							} else {
								output = convertHtmlToMarkdown(raw);
							}
						} else {
							output = raw;
						}
						break;
					case "text":
						if (isHtml) {
							output = extractTextFromHtml(raw);
						} else {
							output = raw;
						}
						break;
					case "html":
						output = raw;
						break;
					default:
						output = raw;
				}

				output = truncateOutput(output);

				return {
					content: [{ type: "text", text: output }],
					details: { url, format, contentType, size: arrayBuffer.byteLength },
				};
			} catch (err: any) {
				const msg = err.name === "AbortError" ? "Request timed out" : err.message;
				throw new Error(msg);
			}
		},

		renderCall(args: any, theme: any) {
			const url = args.url || "";
			const format = args.format && args.format !== "markdown" ? ` (${args.format})` : "";
			const display = url.length > 80 ? url.slice(0, 77) + "..." : url;
			return new Text(
				theme.fg("toolTitle", theme.bold("webfetch ")) + theme.fg("muted", display) + theme.fg("dim", format),
				0,
				0,
			);
		},

		renderResult(result: any, _opts: any, theme: any, context: any) {
			if (context.isError) {
				const text = result.content?.[0];
				return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
			}
			const details = result.details || {};
			const size = details.size ? formatSize(details.size) : "";
			const ct = details.contentType ? details.contentType.split(";")[0] : "";
			const info = [ct, size].filter(Boolean).join(", ");
			return new Text(
				theme.fg("success", "✓ ") + theme.fg("muted", info),
				0,
				0,
			);
		},
	});

	// ========== websearch ==========
	pi.registerTool({
		name: "websearch",
		label: "Web Search",
		description: [
			"Search the web for information using Exa AI. No API key required.",
			"- Performs real-time web searches with up-to-date results",
			"- Returns content from the most relevant websites",
			"- Supports configurable result counts (default: 8)",
			"- Search types: 'auto' (balanced, default), 'fast' (quick), 'deep' (comprehensive)",
			"- Live crawl modes: 'fallback' (default) or 'preferred'",
			"- Use websearch for discovery, webfetch for retrieving a specific URL",
			`- The current year is ${new Date().getFullYear()}. Use the current year when searching for recent information.`,
		].join("\n"),
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			numResults: Type.Optional(
				Type.Number({ description: "Number of results to return (default: 8)" }),
			),
			type: Type.Optional(
				StringEnum(["auto", "fast", "deep"] as const, {
					description: "Search type: 'auto' (default), 'fast', or 'deep'",
				}),
			),
			livecrawl: Type.Optional(
				StringEnum(["fallback", "preferred"] as const, {
					description: "Live crawl mode: 'fallback' (default) or 'preferred'",
				}),
			),
			contextMaxCharacters: Type.Optional(
				Type.Number({ description: "Max characters for context (default: 10000)" }),
			),
		}),

		async execute(
			_toolCallId,
			params: {
				query: string;
				numResults?: number;
				type?: string;
				livecrawl?: string;
				contextMaxCharacters?: number;
			},
			signal,
		) {
			const searchRequest = {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "web_search_exa",
					arguments: {
						query: params.query,
						type: params.type || "auto",
						numResults: params.numResults || DEFAULT_NUM_RESULTS,
						livecrawl: params.livecrawl || "fallback",
						contextMaxCharacters: params.contextMaxCharacters,
					},
				},
			};

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 25_000);
			if (signal) {
				signal.addEventListener("abort", () => controller.abort(), { once: true });
			}

			try {
				const response = await fetch(EXA_MCP_URL, {
					method: "POST",
					headers: {
						Accept: "application/json, text/event-stream",
						"Content-Type": "application/json",
					},
					body: JSON.stringify(searchRequest),
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Search error (HTTP ${response.status}): ${errorText}`);
				}

				const responseText = await response.text();

				// Parse SSE response
				const lines = responseText.split("\n");
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						try {
							const data = JSON.parse(line.substring(6));
							if (data.result?.content?.length > 0) {
								const output = truncateOutput(data.result.content[0].text);
								return {
									content: [{ type: "text", text: output }],
									details: { query: params.query, numResults: params.numResults || DEFAULT_NUM_RESULTS },
								};
							}
						} catch {}
					}
				}

				// Fallback: try parsing as plain JSON
				try {
					const data = JSON.parse(responseText);
					if (data.result?.content?.length > 0) {
						const output = truncateOutput(data.result.content[0].text);
						return {
							content: [{ type: "text", text: output }],
							details: { query: params.query, numResults: params.numResults || DEFAULT_NUM_RESULTS },
						};
					}
				} catch {}

				return {
					content: [{ type: "text", text: "No search results found. Try a different query." }],
					details: { query: params.query, numResults: params.numResults || DEFAULT_NUM_RESULTS },
				};
			} catch (err: any) {
				clearTimeout(timeoutId);
				const msg = err.name === "AbortError" ? "Search request timed out" : err.message;
				throw new Error(msg);
			}
		},

		renderCall(args: any, theme: any) {
			const query = args.query || "";
			const display = query.length > 80 ? query.slice(0, 77) + "..." : query;
			const extra = args.type && args.type !== "auto" ? ` (${args.type})` : "";
			return new Text(
				theme.fg("toolTitle", theme.bold("websearch ")) + theme.fg("muted", `"${display}"`) + theme.fg("dim", extra),
				0,
				0,
			);
		},

		renderResult(result: any, _opts: any, theme: any, context: any) {
			if (context.isError) {
				const text = result.content?.[0];
				return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
			}
			const details = result.details || {};
			const content = result.content?.[0]?.text || "";
			const lines = content.split("\n").length;
			const size = formatSize(Buffer.byteLength(content, "utf-8"));
			return new Text(
				theme.fg("success", "✓ ") +
					theme.fg("muted", `${lines} lines, ${size}`) +
					(details.query ? theme.fg("dim", ` — "${details.query}"`) : ""),
				0,
				0,
			);
		},
	});
}
