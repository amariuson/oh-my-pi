import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, isEnoent, logger } from "@oh-my-pi/pi-utils";
import { MODEL_ROLE_IDS } from "../config/model-roles";
import { expandAtImports } from "../discovery/at-imports";
import { repo } from "../utils/git";

export type AdvisorProfileMode = "triggered" | "always";

export interface AdvisorInstanceRange {
	min: number;
	max: number;
}

export interface AdvisorProfile {
	id: string;
	label?: string;
	description?: string;
	model?: string;
	when?: string;
	mode?: AdvisorProfileMode;
	instances?: AdvisorInstanceRange;
	prompt: string;
	sourcePath: string;
	level: "user" | "project";
}

const ADVISOR_FILE_NAMES = ["ADVISORS.md", "ADVISOR.md"] as const;

const MODEL_ROLE_ID_SET = new Set<string>(MODEL_ROLE_IDS);

export function normalizeDynamicAdvisorModelSelector(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	return MODEL_ROLE_ID_SET.has(trimmed) ? `pi/${trimmed}` : trimmed;
}

function slugifyAdvisorId(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function parseField(line: string): { key: string; value: string } | null {
	const match = line.match(/^([A-Za-z][A-Za-z0-9 _-]*):\s*(.*)$/);
	if (!match) return null;
	return {
		key: match[1]
			.trim()
			.toLowerCase()
			.replace(/[ _-]+/g, ""),
		value: match[2].trim(),
	};
}

function parseAdvisorMode(value: string): AdvisorProfileMode | undefined {
	const normalized = value.trim().toLowerCase();
	if (["always", "required", "running"].includes(normalized)) return "always";
	if (["triggered", "manual", "on-demand", "ondemand"].includes(normalized)) return "triggered";
	return undefined;
}

function parseAdvisorInstances(value: string): AdvisorInstanceRange | undefined {
	const match = value.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
	if (!match) return undefined;
	const min = Number.parseInt(match[1], 10);
	const rawMax = match[2] === undefined ? min : Number.parseInt(match[2], 10);
	if (!Number.isFinite(min) || !Number.isFinite(rawMax)) return undefined;
	return { min, max: Math.max(min, rawMax) };
}

function parseAdvisorSection(
	heading: string,
	body: string,
	sourcePath: string,
	level: "user" | "project",
): AdvisorProfile | null {
	const headingField = parseField(heading);
	const explicitId = headingField?.key === "id" ? headingField.value : undefined;
	const id = slugifyAdvisorId(explicitId ?? heading);
	if (!id) return null;

	let label = headingField?.key === "id" ? undefined : heading.trim();
	let description: string | undefined;
	let model: string | undefined;
	let when: string | undefined;
	let mode: AdvisorProfileMode | undefined;
	let instances: AdvisorInstanceRange | undefined;
	let promptStart: number | undefined;
	const lines = body.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const field = parseField(lines[i]);
		if (!field) continue;
		if (field.key === "label") label = field.value;
		if (field.key === "description") description = field.value;
		if (field.key === "model") model = field.value;
		if (field.key === "when") when = field.value;
		if (field.key === "mode") mode = parseAdvisorMode(field.value);
		if (field.key === "instances") instances = parseAdvisorInstances(field.value);
		if (field.key === "prompt") {
			promptStart = i;
			if (field.value) lines[i] = field.value;
			else lines[i] = "";
			break;
		}
	}

	const promptText = (promptStart === undefined ? body : lines.slice(promptStart).join("\n")).trim();
	if (!promptText) return null;

	return { id, label, description, model, when, mode, instances, prompt: promptText, sourcePath, level };
}

export function parseAdvisorProfilesMarkdown(
	content: string,
	sourcePath = "ADVISORS.md",
	level: "user" | "project" = "project",
): AdvisorProfile[] {
	const sections: AdvisorProfile[] = [];
	const headingPattern = /^##\s+(.+)$/gm;
	const matches = [...content.matchAll(headingPattern)];
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const heading = match[1];
		const start = (match.index ?? 0) + match[0].length;
		const end = matches[i + 1]?.index ?? content.length;
		const profile = parseAdvisorSection(heading, content.slice(start, end), sourcePath, level);
		if (profile) sections.push(profile);
	}
	return sections;
}

export async function discoverAdvisorProfiles(
	cwd: string,
	agentDir?: string,
	options: { includeProject?: boolean } = {},
): Promise<AdvisorProfile[]> {
	const home = os.homedir();
	const resolvedAgentDir = agentDir ?? getAgentDir();
	let repoRoot: string | null = null;
	try {
		repoRoot = await repo.root(cwd);
	} catch (err) {
		logger.debug("Failed to resolve git root for advisor profile discovery", { err: String(err) });
	}

	const candidates: Array<{ path: string; level: "user" | "project"; depth: number }> = [];
	if (resolvedAgentDir) {
		for (const fileName of ADVISOR_FILE_NAMES) {
			candidates.push({
				path: path.resolve(resolvedAgentDir, fileName),
				level: "user",
				depth: Number.POSITIVE_INFINITY,
			});
		}
	}

	if (options.includeProject !== false) {
		let current = cwd;
		while (true) {
			for (const fileName of ADVISOR_FILE_NAMES) {
				const candidate = path.resolve(current, ".omp", fileName);
				const relative = path.relative(cwd, current);
				const depth = relative === "" ? 0 : relative.split(path.sep).filter(Boolean).length;
				candidates.push({ path: candidate, level: "project", depth });
			}
			if (current === (repoRoot ?? home)) break;
			const parent = path.dirname(current);
			if (parent === current) break;
			current = parent;
		}
	}

	candidates.sort((a, b) => {
		if (a.level !== b.level) return a.level === "user" ? -1 : 1;
		return b.depth - a.depth;
	});

	const profiles = new Map<string, AdvisorProfile>();
	for (const candidate of candidates) {
		try {
			const content = await Bun.file(candidate.path).text();
			const expanded = await expandAtImports(content, candidate.path);
			for (const profile of parseAdvisorProfilesMarkdown(expanded, candidate.path, candidate.level)) {
				profiles.set(profile.id, profile);
			}
		} catch (err) {
			if (!isEnoent(err)) {
				logger.warn("Failed to read advisor profile file", { path: candidate.path, error: String(err) });
			}
		}
	}
	return [...profiles.values()];
}

export function formatAdvisorProfilesForPrompt(profiles: AdvisorProfile[]): string | undefined {
	if (profiles.length === 0) return undefined;
	const lines = [
		"## Available dynamic advisors",
		"",
		"At task start and before risky changes, consider whether a focused advisor would catch mistakes you might miss. Spawn one-shot advisors for concrete risks; skip them when no profile is relevant. Persistent profiles run only when configured.",
		"`Mode: always` means start persistent advisors. `Instances: min-max` starts `min` persistent advisors; `max` is a routing cap hint, not automatic fan-out. Session cap: `advisor.pool.maxInstances`.",
		"",
		"Named advisors from ADVISORS.md:",
	];
	for (const profile of profiles) {
		const label = profile.label && profile.label !== profile.id ? ` (${profile.label})` : "";
		const parts = [`- \`${profile.id}\`${label}`];
		if (profile.model) parts.push(`model hint: ${profile.model}`);
		if (profile.when) parts.push(`when: ${profile.when}`);
		if (profile.mode) parts.push(`mode: ${profile.mode}`);
		if (profile.instances) {
			parts.push(`persistent: ${profile.instances.min}`);
			parts.push(`max concurrent hint: ${profile.instances.max}`);
		}
		if (profile.description) parts.push(profile.description);
		lines.push(parts.join(" — "));
	}
	return lines.join("\n");
}
