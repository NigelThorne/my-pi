/** Thin synchronous-launcher adapter over the canonical packaged agent registry. */
import {
	discoverAgents as discoverCanonicalAgents,
	type AgentScope,
	type AgentSource,
} from "../pi-interactive-subagents/pi-extension/subagents/agent-registry.ts";

export type { AgentScope };

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	thinking?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
	fileHash: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const discovery = discoverCanonicalAgents({ cwd, scope });
	return {
		projectAgentsDir: discovery.projectAgentsDir,
		agents: discovery.agents.map((agent) => ({
			name: agent.name,
			description: agent.description ?? "",
			tools: agent.tools?.split(",").map((tool) => tool.trim()).filter(Boolean),
			model: agent.model,
			thinking: agent.thinking,
			systemPrompt: agent.body ?? "",
			source: agent.source,
			filePath: agent.filePath,
			fileHash: agent.fileHash,
		})),
	};
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	return {
		text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
		remaining: agents.length - listed.length,
	};
}
