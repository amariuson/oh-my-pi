import { beforeAll, describe, expect, it } from "bun:test";
import type { AgentSession } from "../../../session/agent-session";
import { setTheme } from "../../theme/theme";
import { renderSegment } from "./segments";
import type { SegmentContext } from "./types";

function contextWithAdvisorCount(advisorCount: number): SegmentContext {
	const session = {
		state: { model: { id: "test-model", name: "Test Model" } },
		isFastModeActive: () => false,
		isAutoThinking: false,
		autoResolvedThinkingLevel: () => undefined,
		getAdvisorActiveCount: () => advisorCount,
	} as unknown as AgentSession;

	return {
		session,
		width: 120,
		options: {},
		planMode: null,
		loopMode: null,
		goalMode: null,
		collab: null,
		usageStats: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			premiumRequests: 0,
			cost: 0,
			tokensPerSecond: null,
		},
		contextPercent: null,
		contextTokens: 0,
		contextWindow: 0,
		autoCompactEnabled: false,
		subagentCount: 0,
		sessionStartTime: Date.now(),
		activeRepo: null,
		git: {
			branch: null,
			status: null,
			pr: null,
		},
		usage: null,
	};
}

beforeAll(async () => {
	await setTheme("dark", false);
});

describe("model status-line segment", () => {
	it("shows the active advisor count instead of a generic badge", () => {
		const inactive = Bun.stripANSI(renderSegment("model", contextWithAdvisorCount(0)).content);
		const oneAdvisor = Bun.stripANSI(renderSegment("model", contextWithAdvisorCount(1)).content);
		const threeAdvisors = Bun.stripANSI(renderSegment("model", contextWithAdvisorCount(3)).content);

		expect(inactive).toContain("Test Model");
		expect(inactive).not.toContain(" 1");
		expect(oneAdvisor).toContain("Test Model");
		expect(oneAdvisor).toContain(" 1");
		expect(threeAdvisors).toContain("Test Model");
		expect(threeAdvisors).toContain(" 3");
		expect(threeAdvisors).not.toContain("++");
	});
});
