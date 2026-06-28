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
	parseAdvisorProfilesYaml,
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

describe("parseAdvisorProfilesYaml", () => {
	it("parses yaml advisor profiles", () => {
		const profiles = parseAdvisorProfilesYaml(
			[
				"advisors:",
				"  correctness:",
				"    label: Correctness",
				"    description: Checks logic",
				"    model: slow",
				"    when: complex logic",
				"    mode: always",
				"    instances:",
				"      min: 1",
				"      max: 3",
				"    prompt: Review behavior and edge cases.",
				"  docs:",
				"    instances:",
				"      min: 0",
				"      max: 2",
				"    prompt: Keep docs accurate.",
			].join("\n"),
			"ADVISORS.yaml",
			"project",
		);

		expect(profiles.map(profile => profile.id)).toEqual(["correctness", "docs"]);
		expect(profiles[0]).toMatchObject({
			label: "Correctness",
			description: "Checks logic",
			model: "slow",
			when: "complex logic",
			mode: "always",
			instances: { min: 1, max: 3 },
			prompt: "Review behavior and edge cases.",
		});
		expect(profiles[1].instances).toEqual({ min: 0, max: 2 });
	});
});

describe("formatAdvisorProfilesForPrompt", () => {
	it("advertises ids and routing hints without exposing full prompts", () => {
		const profiles = parseAdvisorProfilesYaml(
			[
				"advisors:",
				"  correctness:",
				"    description: Checks logic",
				"    model: slow",
				"    when: complex logic",
				"    mode: always",
				"    instances:",
				"      min: 0",
				"      max: 1",
				"    prompt: Private detailed review rubric.",
			].join("\n"),
			"ADVISORS.yaml",
		);

		const rendered = formatAdvisorProfilesForPrompt(profiles);

		expect(rendered).toContain("`correctness`");
		expect(rendered).toContain("when: complex logic");
		expect(rendered).toContain("model hint: slow");
		expect(rendered).toContain("`mode: always` means start persistent advisors");
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
	it("keeps default dynamic advisor settings compatible with YAML model hints", () => {
		const settings = Settings.isolated();
		const profile = parseAdvisorProfilesYaml(
			["advisors:", "  correctness:", "    model: slow", "    prompt: Review logic."].join("\n"),
			"ADVISORS.yaml",
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
			path.join(agentDir, "ADVISORS.yaml"),
			["advisors:", "  correctness:", "    prompt: User-level correctness review."].join("\n"),
		);
		await fs.writeFile(
			path.join(root, ".omp", "ADVISORS.yaml"),
			[
				"advisors:",
				"  correctness:",
				"    prompt: Project-specific correctness review.",
				"  security:",
				"    prompt: Review auth and secrets risk.",
			].join("\n"),
		);

		const profiles = await discoverAdvisorProfiles(root, agentDir);

		expect(profiles.map(profile => profile.id)).toEqual(["correctness", "security"]);
		expect(profiles[0].prompt).toBe("Project-specific correctness review.");
		expect(profiles[1].level).toBe("project");
	});
});
