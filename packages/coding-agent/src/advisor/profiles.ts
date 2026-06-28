import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, isEnoent, logger } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
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

const ADVISOR_FILE_NAMES = ["ADVISORS.yaml", "ADVISORS.yml", "ADVISOR.yaml", "ADVISOR.yml"] as const;

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

function normalizeAdvisorRecord(
	id: string,
	record: Record<string, unknown>,
	sourcePath: string,
	level: "user" | "project",
): AdvisorProfile | null {
	const normalizedId = slugifyAdvisorId(id);
	if (!normalizedId) return null;
	const promptValue = record.prompt;
	const promptText = typeof promptValue === "string" ? promptValue.trim() : "";
	if (!promptText) return null;
	const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined;
	const description =
		typeof record.description === "string" && record.description.trim() ? record.description.trim() : undefined;
	const model = typeof record.model === "string" && record.model.trim() ? record.model.trim() : undefined;
	const when = typeof record.when === "string" && record.when.trim() ? record.when.trim() : undefined;
	const mode = typeof record.mode === "string" ? parseAdvisorMode(record.mode) : undefined;
	const instances = parseAdvisorInstancesValue(record.instances);
	return {
		id: normalizedId,
		label,
		description,
		model,
		when,
		mode,
		instances,
		prompt: promptText,
		sourcePath,
		level,
	};
}

function parseAdvisorInstancesValue(value: unknown): AdvisorInstanceRange | undefined {
	if (typeof value === "string" || typeof value === "number") return parseAdvisorInstances(String(value));
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const min = typeof record.min === "number" ? record.min : Number.parseInt(String(record.min ?? ""), 10);
	const max = typeof record.max === "number" ? record.max : Number.parseInt(String(record.max ?? min), 10);
	if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
	const normalizedMin = Math.max(0, Math.trunc(min));
	return { min: normalizedMin, max: Math.max(normalizedMin, Math.trunc(max)) };
}

export function parseAdvisorProfilesYaml(
	content: string,
	sourcePath = "ADVISORS.yaml",
	level: "user" | "project" = "project",
): AdvisorProfile[] {
	const parsed = YAML.parse(content);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
	const root = parsed as Record<string, unknown>;
	const advisors = root.advisors;
	if (!advisors || typeof advisors !== "object") return [];
	if (Array.isArray(advisors)) {
		return advisors
			.map(entry => {
				if (!entry || typeof entry !== "object") return null;
				const record = entry as Record<string, unknown>;
				const id = typeof record.id === "string" ? record.id : "";
				return normalizeAdvisorRecord(id, record, sourcePath, level);
			})
			.filter((profile): profile is AdvisorProfile => profile !== null);
	}
	return Object.entries(advisors as Record<string, unknown>)
		.map(([id, value]) => {
			if (!value || typeof value !== "object" || Array.isArray(value)) return null;
			return normalizeAdvisorRecord(id, value as Record<string, unknown>, sourcePath, level);
		})
		.filter((profile): profile is AdvisorProfile => profile !== null);
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
			for (const profile of parseAdvisorProfilesYaml(expanded, candidate.path, candidate.level)) {
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
		"`mode: always` means start persistent advisors. `instances.min` starts that many persistent advisors; `instances.max` is a routing cap hint, not automatic fan-out. Session cap: `advisor.pool.maxInstances`.",
		"",
		"Named advisors from ADVISORS.yaml:",
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
