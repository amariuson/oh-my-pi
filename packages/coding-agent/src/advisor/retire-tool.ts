import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { type } from "arktype";
import retireDescription from "../prompts/advisor/retire-tool.md" with { type: "text" };

const retireAdvisorSchema = type({
	"reason?": type("string").describe("Why this advisor no longer needs to monitor future turns."),
});

export type RetireAdvisorParams = typeof retireAdvisorSchema.infer;

export interface RetireAdvisorDetails {
	reason?: string;
}

export class RetireAdvisorTool implements AgentTool<typeof retireAdvisorSchema, RetireAdvisorDetails> {
	readonly name = "retire_advisor";
	readonly label = "Retire Advisor";
	readonly description = retireDescription;
	readonly parameters = retireAdvisorSchema;
	readonly intent = "omit" as const;

	constructor(private readonly onRetire: (reason?: string) => void) {}

	async execute(
		_toolCallId: string,
		args: RetireAdvisorParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<RetireAdvisorDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<RetireAdvisorDetails>> {
		const reason = args.reason?.trim() || undefined;
		this.onRetire(reason);
		return {
			content: [{ type: "text", text: "Advisor marked done." }],
			details: { reason },
			useless: true,
		};
	}
}
