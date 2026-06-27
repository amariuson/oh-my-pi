import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { type } from "arktype";
import type { AdvisorSeverity } from "../advisor";
import spawnAdvisorDescription from "../prompts/tools/spawn-advisor.md" with { type: "text" };
import type { ToolSession } from "./index";
import type { OutputMeta } from "./output-meta";
import { ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";

const spawnAdvisorSchema = type({
	"advisor?": type("string").describe("Named advisor profile from ADVISORS.md / ADVISOR.md."),
	"role?": type("string").describe("Ad-hoc advisor role, for example 'security reviewer'."),
	focus: type("string").describe("Concrete question, risk, or artifact for the advisor to review."),
	"model?": type("string").describe("Optional model role/spec allowed by advisor.dynamic.allowedModels."),
	"context?": type("'transcript' | 'last_turn'").describe(
		"Context window to show the advisor. Defaults to last_turn; use transcript only for cross-turn questions.",
	),
});

export type SpawnAdvisorParams = typeof spawnAdvisorSchema.infer;

export interface DynamicAdvisorNote {
	severity: AdvisorSeverity;
	note: string;
	evidence?: string;
}

export interface DynamicAdvisorResult {
	advisorId: string;
	role: string;
	model: string;
	notes: DynamicAdvisorNote[];
}

export interface SpawnAdvisorDetails extends DynamicAdvisorResult {
	meta?: OutputMeta;
}

function formatAdvisorResult(result: DynamicAdvisorResult): string {
	const header = `Advisor ${result.advisorId} (${result.role}, ${result.model})`;
	if (result.notes.length === 0) return `${header}\nNo concrete advice.`;
	const notes = result.notes
		.map((note, index) => {
			const evidence = note.evidence ? `\n  Evidence: ${note.evidence}` : "";
			return `${index + 1}. [${note.severity}] ${note.note}${evidence}`;
		})
		.join("\n");
	return `${header}\n${notes}`;
}

export class SpawnAdvisorTool implements AgentTool<typeof spawnAdvisorSchema, SpawnAdvisorDetails> {
	readonly name = "spawn_advisor";
	readonly label = "Spawn Advisor";
	readonly description = spawnAdvisorDescription;
	readonly parameters = spawnAdvisorSchema;
	readonly approval = "read" as const;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): SpawnAdvisorTool | null {
		if (!session.settings.get("advisor.enabled")) return null;
		if (!session.settings.get("advisor.dynamic.enabled")) return null;
		if (!session.runDynamicAdvisor) return null;
		return new SpawnAdvisorTool(session);
	}

	async execute(
		_toolCallId: string,
		params: SpawnAdvisorParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SpawnAdvisorDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<SpawnAdvisorDetails>> {
		if (!params.advisor?.trim() && !params.role?.trim()) {
			throw new ToolError("spawn_advisor requires either `advisor` or `role`.");
		}
		if (!params.focus.trim()) {
			throw new ToolError("spawn_advisor requires a non-empty `focus`.");
		}
		const result = await this.session.runDynamicAdvisor?.(params, signal);
		if (!result) throw new ToolError("Dynamic advisor runtime is unavailable for this session.");
		return toolResult<SpawnAdvisorDetails>(result).text(formatAdvisorResult(result)).done();
	}
}
