import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as prompt from "@oh-my-pi/pi-utils/prompt";
import { Settings } from "../../config/settings";
import advisorProfilePrompt from "../../prompts/advisor/profile-context.md" with { type: "text" };
import {
	discoverAdvisorProfiles,
	formatAdvisorProfilesForPrompt,
	normalizeDynamicAdvisorModelSelector,
	parseAdvisorProfilesMarkdown,
} from "../profiles";

let tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
	tempDirs = [];
});

async function tempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-advisors-"));
	tempDirs.push(dir);
	return dir;
}

describe("parseAdvisorProfilesMarkdown", () => {
	it("parses declarative advisor profiles", () => {
		const profiles = parseAdvisorProfilesMarkdown(
			[
				"# Advisors",
				"",
				"## correctness",
				"Description: Checks logic",
				"Model: slow",
				"When: complex logic",
				"Mode: always",
				"Instances: 1-2",
				"Prompt:",
				"Find missed edge cases.",
				"",
				"## Tests",
				"Prompt: Review test behavior coverage.",
			].join("\n"),
			"ADVISORS.md",
		);

		expect(profiles).toHaveLength(2);
		expect(profiles[0]).toMatchObject({
			id: "correctness",
			description: "Checks logic",
			model: "slow",
			when: "complex logic",
			mode: "always",
			instances: { min: 1, max: 2 },
			prompt: "Find missed edge cases.",
		});
		expect(profiles[1]).toMatchObject({
			id: "tests",
			label: "Tests",
			prompt: "Review test behavior coverage.",
		});
	});
});

describe("advisor profile prompt", () => {
	it("renders trigger hints from profiles with a when field", () => {
		const rendered = prompt.render(advisorProfilePrompt, {
			role: "Correctness",
			mode: "",
			persistentInstances: "",
			maxConcurrentInstances: "",
			when: "complex logic",
			instructions: "Find missed edge cases.",
		});

		expect(rendered).toContain("Trigger hints: complex logic");
		expect(rendered).toContain("Find missed edge cases.");
	});
});

describe("formatAdvisorProfilesForPrompt", () => {
	it("advertises ids and routing hints without exposing full prompts", () => {
		const profiles = parseAdvisorProfilesMarkdown(
			[
				"## correctness",
				"Description: Checks logic",
				"Model: slow",
				"When: complex logic",
				"Mode: always",
				"Instances: 0-1",
				"Prompt:",
				"Private detailed review rubric.",
			].join("\n"),
			"ADVISORS.md",
		);

		const rendered = formatAdvisorProfilesForPrompt(profiles);

		expect(rendered).toContain("`correctness`");
		expect(rendered).toContain("when: complex logic");
		expect(rendered).toContain("model hint: slow");
		expect(rendered).toContain("`Mode: always` means start persistent advisors");
		expect(rendered).toContain("advisor.pool.maxInstances");
		expect(rendered).toContain("mode: always");
		expect(rendered).toContain("persistent: 0");
		expect(rendered).toContain("max concurrent hint: 1");
		expect(rendered).toContain("Checks logic");
		expect(rendered).toContain("At task start and before risky changes");
		expect(rendered).toContain("skip them when no profile is relevant");
		expect(rendered).not.toContain("Private detailed review rubric");
	});
});

describe("normalizeDynamicAdvisorModelSelector", () => {
	it("keeps default dynamic advisor settings compatible with ADVISORS.md model hints", () => {
		const settings = Settings.isolated();
		const profile = parseAdvisorProfilesMarkdown(
			["## correctness", "Model: slow", "Prompt: Review logic."].join("\n"),
			"ADVISORS.md",
		)[0];

		const defaultModel = normalizeDynamicAdvisorModelSelector(settings.get("advisor.dynamic.defaultModel"));
		const allowedModels = settings
			.get("advisor.dynamic.allowedModels")
			.map(normalizeDynamicAdvisorModelSelector)
			.filter((value): value is string => !!value);
		const profileModel = normalizeDynamicAdvisorModelSelector(profile?.model);
		if (!profileModel) throw new Error("Expected profile model");

		expect(defaultModel).toBe("pi/smol");
		expect(profileModel).toBe("pi/slow");
		expect(allowedModels).toContain(profileModel);
	});

	it("preserves concrete model selectors", () => {
		expect(normalizeDynamicAdvisorModelSelector("openai-codex/gpt-5.5:xhigh")).toBe("openai-codex/gpt-5.5:xhigh");
	});
});

describe("discoverAdvisorProfiles", () => {
	it("loads user and project advisor rosters with project overriding duplicate ids", async () => {
		const root = await tempDir();
		const agentDir = await tempDir();
		await fs.mkdir(path.join(root, ".omp"));
		await fs.writeFile(
			path.join(agentDir, "ADVISORS.md"),
			["## correctness", "Prompt: User-level correctness review."].join("\n"),
		);
		await fs.writeFile(
			path.join(root, ".omp", "ADVISORS.md"),
			[
				"## correctness",
				"Prompt: Project-specific correctness review.",
				"",
				"## security",
				"Prompt: Review auth and secrets risk.",
			].join("\n"),
		);

		const profiles = await discoverAdvisorProfiles(root, agentDir);

		expect(profiles.map(profile => profile.id)).toEqual(["correctness", "security"]);
		expect(profiles[0].prompt).toBe("Project-specific correctness review.");
		expect(profiles[1].level).toBe("project");
	});
});
