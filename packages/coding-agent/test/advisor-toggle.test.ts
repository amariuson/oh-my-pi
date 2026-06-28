import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";
import { createAssistantMessage } from "./helpers/agent-session-setup";

describe("AgentSession advisor toggle", () => {
	let sharedDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let model: Model;

	beforeAll(async () => {
		sharedDir = TempDir.createSync("@pi-advisor-toggle-shared-");
		authStorage = await AuthStorage.create(path.join(sharedDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
		const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!bundled) throw new Error("Expected built-in anthropic model to exist");
		model = bundled;
	});

	afterAll(async () => {
		authStorage.close();
		try {
			await sharedDir.remove();
		} catch {}
	});

	let tempDir: TempDir;
	let session: AgentSession;
	let sessionManager: SessionManager;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-advisor-toggle-");
		sessionManager = SessionManager.create(tempDir.path(), tempDir.path());
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});
		const settings = Settings.isolated({ "compaction.enabled": false });
		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});
	});

	afterEach(async () => {
		await session.dispose();
		try {
			await tempDir.remove();
		} catch {}
	});

	it("starts with advisor disabled", () => {
		expect(session.isAdvisorActive()).toBe(false);
		expect(session.isAdvisorEnabled()).toBe(false);
		expect(session.formatAdvisorStatus()).toBe("Advisor is disabled.");
	});

	it("toggle enables the advisor and runtime", () => {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		const active = session.toggleAdvisorEnabled();
		expect(active).toBe(true);
		expect(session.isAdvisorActive()).toBe(true);
		expect(session.isAdvisorEnabled()).toBe(true);
		expect(session.formatAdvisorStatus()).toContain("Advisor is enabled (anthropic/claude-sonnet-4-5)");
	});

	it("explicit enable overrides default-off setting for the session only", () => {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		session.settings.override("advisor.enabled", false);
		const customSession = new AgentSession({
			agent: session.agent,
			sessionManager,
			settings: session.settings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});
		expect(customSession.isAdvisorEnabled()).toBe(false);

		const active = customSession.setAdvisorEnabled(true);

		expect(active).toBe(true);
		expect(customSession.isAdvisorActive()).toBe(true);
		expect(customSession.isAdvisorEnabled()).toBe(true);
		expect(customSession.settings.get("advisor.enabled")).toBe(false);
	});

	it("toggle disables the advisor and runtime", () => {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		session.toggleAdvisorEnabled();
		const active = session.toggleAdvisorEnabled();
		expect(active).toBe(false);
		expect(session.isAdvisorActive()).toBe(false);
		expect(session.isAdvisorEnabled()).toBe(false);
	});

	it("setAdvisorEnabled reports inactive when the advisor role resolves to no model", () => {
		// The advisor role falls back to the `slow` priority chain when unset, so an
		// unset role still resolves a model. The inactive-but-enabled path is only
		// reached when the configured advisor model cannot be resolved at all.
		session.settings.setModelRole("advisor", "nonexistent/advisor-model");
		const active = session.setAdvisorEnabled(true);
		expect(active).toBe(false);
		expect(session.isAdvisorActive()).toBe(false);
		expect(session.isAdvisorEnabled()).toBe(true);
		expect(session.formatAdvisorStatus()).toBe(
			"Advisor setting is enabled, but no model is assigned to the 'advisor' role.",
		);
	});

	it("starts persistent profile advisors from ADVISORS metadata without the singleton advisor role", async () => {
		const poolSettings = Settings.isolated({
			"advisor.enabled": true,
			"advisor.dynamic.enabled": true,
			"advisor.dynamic.allowedModels": ["*"],
			"advisor.pool.maxInstances": 2,
			"compaction.enabled": false,
		});
		const poolDir = TempDir.createSync("@pi-advisor-pool-");
		const poolSessionManager = SessionManager.create(poolDir.path(), poolDir.path());
		const poolAgent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});
		const poolSession = new AgentSession({
			agent: poolAgent,
			sessionManager: poolSessionManager,
			settings: poolSettings,
			modelRegistry,
			advisorReadOnlyTools: [],
			advisorProfiles: [
				{
					id: "correctness",
					label: "Correctness",
					model: "anthropic/claude-sonnet-4-5",
					mode: "triggered",
					instances: { min: 3, max: 5 },
					prompt: "Find correctness bugs.",
					sourcePath: "ADVISORS.yaml",
					level: "project",
				},
			],
		});
		try {
			expect(poolSession.isAdvisorActive()).toBe(true);
			expect(poolSession.formatAdvisorStatus()).toContain("Advisor is enabled");
			const dump = poolSession.formatAdvisorHistoryAsText();
			expect(dump).toContain("# Advisor correctness-1");
			expect(dump).toContain("# Advisor correctness-2");
			expect(dump).not.toContain("# Advisor correctness-3");
		} finally {
			await poolSession.dispose();
			await poolDir.remove();
		}
	});

	it("rekeys persistent profile advisor API resolution after a new session", async () => {
		const poolSettings = Settings.isolated({
			"advisor.enabled": true,
			"advisor.dynamic.enabled": true,
			"advisor.dynamic.allowedModels": ["*"],
			"advisor.pool.maxInstances": 1,
			"advisor.syncBacklog": "1",
			"compaction.enabled": false,
			"retry.enabled": false,
		});
		const poolDir = TempDir.createSync("@pi-advisor-pool-session-id-");
		const poolSessionManager = SessionManager.create(poolDir.path(), poolDir.path());
		const primaryModel = createMockModel({
			responses: [{ content: ["first"] }, { content: ["second"] }],
		});
		const poolAgent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
			streamFn: primaryModel.stream,
		});
		const advisorRequestSessionIds: string[] = [];
		const poolModelRegistry = new ModelRegistry(authStorage);
		const advisorApi = "test-advisor-rekey" as Api;
		const advisorSourceId = "advisor-toggle-rekey-test";
		poolModelRegistry.registerProvider(
			"advisor-rekey",
			{
				api: advisorApi,
				apiKey: "test-key",
				baseUrl: "https://advisor-rekey.invalid",
				models: [
					{
						id: "reviewer",
						name: "Reviewer",
						api: advisorApi,
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 200_000,
						maxTokens: 32_768,
					},
				],
				streamSimple: (_requestModel, _context, options) => {
					advisorRequestSessionIds.push(options?.sessionId ?? "");
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						const text = JSON.stringify({ notes: [] });
						const message = createAssistantMessage(text);
						stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
						stream.push({ type: "done", reason: "stop", message });
					});
					return stream;
				},
			},
			advisorSourceId,
		);
		const poolSession = new AgentSession({
			agent: poolAgent,
			sessionManager: poolSessionManager,
			settings: poolSettings,
			modelRegistry: poolModelRegistry,
			advisorReadOnlyTools: [],
			advisorProfiles: [
				{
					id: "correctness",
					label: "Correctness",
					model: "advisor-rekey/reviewer",
					mode: "always",
					prompt: "Find correctness bugs.",
					sourcePath: "ADVISORS.yaml",
					level: "project",
				},
			],
		});
		try {
			const firstSessionId = poolSession.sessionId;
			await poolSession.prompt("first");
			await poolSession.waitForIdle();
			expect(advisorRequestSessionIds).toContain(`${firstSessionId}-advisor-correctness-1`);

			advisorRequestSessionIds.length = 0;
			await poolSession.newSession();
			const secondSessionId = poolSession.sessionId;
			expect(secondSessionId).not.toBe(firstSessionId);
			await poolSession.prompt("second");
			await poolSession.waitForIdle();
			expect(advisorRequestSessionIds).toContain(`${secondSessionId}-advisor-correctness-1`);
			expect(advisorRequestSessionIds).not.toContain(`${firstSessionId}-advisor-correctness-1`);
		} finally {
			poolModelRegistry.clearSourceRegistrations(advisorSourceId);
			await poolSession.dispose();
			await poolDir.remove();
		}
	});

	it("keeps sessions isolated when sharing a Settings instance", async () => {
		const sharedSettings = Settings.isolated({ "compaction.enabled": false });
		sharedSettings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		expect(sharedSettings.get("advisor.enabled")).toBe(false);

		const sessionA = new AgentSession({
			agent: session.agent,
			sessionManager,
			settings: sharedSettings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});
		const sessionB = new AgentSession({
			agent: session.agent,
			sessionManager,
			settings: sharedSettings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});

		expect(sessionA.isAdvisorEnabled()).toBe(false);
		expect(sessionB.isAdvisorEnabled()).toBe(false);

		const activeA = sessionA.setAdvisorEnabled(true);
		expect(activeA).toBe(true);
		expect(sessionA.isAdvisorEnabled()).toBe(true);
		expect(sessionA.isAdvisorActive()).toBe(true);

		expect(sessionB.isAdvisorEnabled()).toBe(false);
		expect(sessionB.isAdvisorActive()).toBe(false);
		expect(sessionB.formatAdvisorStatus()).toBe("Advisor is disabled.");

		const activeB = sessionB.toggleAdvisorEnabled();
		expect(activeB).toBe(true);
		expect(sessionB.isAdvisorEnabled()).toBe(true);

		sessionA.setAdvisorEnabled(false);
		expect(sessionA.isAdvisorEnabled()).toBe(false);
		expect(sessionA.isAdvisorActive()).toBe(false);

		expect(sessionB.isAdvisorEnabled()).toBe(true);
		expect(sessionB.isAdvisorActive()).toBe(true);
	});
});
