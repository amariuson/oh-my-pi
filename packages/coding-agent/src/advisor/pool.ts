import type { Agent } from "@oh-my-pi/pi-agent-core";
import type { AdviseTool } from "./advise-tool";
import type { AdvisorEmissionGuard } from "./emission-guard";
import type { AdvisorProfile } from "./profiles";
import type { AdvisorRuntime } from "./runtime";
import type { AdvisorTranscriptRecorder } from "./transcript-recorder";

export interface AdvisorPoolMember {
	key: string;
	runtime: AdvisorRuntime;
	agent: Agent;
	role: string;
	adviseTool: AdviseTool;
	emissionGuard: AdvisorEmissionGuard;
	recorder: AdvisorTranscriptRecorder;
	unsubscribe?: () => void;
}

interface AdvisorPoolOptions {
	profiles: () => readonly AdvisorProfile[];
	canStart: () => boolean;
	maxInstances: () => number;
	currentMessageCount: () => number;
	createMember: (
		profile: AdvisorProfile,
		index: number,
		recorderClosed: Promise<void>,
	) => AdvisorPoolMember | undefined;
	onStarted: () => void;
}

export class AdvisorPool {
	#members = new Map<string, AdvisorPoolMember>();
	#options: AdvisorPoolOptions;
	#recorderClosed: Promise<void> = Promise.resolve();

	constructor(options: AdvisorPoolOptions) {
		this.#options = options;
	}

	get size(): number {
		return this.#members.size;
	}

	get recorderClosed(): Promise<void> {
		return this.#recorderClosed;
	}

	build(seedToCurrent = false): boolean {
		if (!this.#options.canStart()) return this.size > 0;
		const cap = this.#options.maxInstances();
		if (cap <= 0) return this.size > 0;
		let remaining = Math.max(0, cap - this.size);
		if (remaining === 0) return this.size > 0;

		for (const profile of this.#options.profiles()) {
			const minInstances = this.#profileMinInstances(profile);
			if (minInstances <= 0) continue;
			for (let index = 0; index < minInstances && remaining > 0; index++) {
				const key = `${profile.id}-${index + 1}`;
				if (this.#members.has(key)) continue;
				const member = this.#options.createMember(profile, index, this.#recorderClosed);
				if (!member) continue;
				this.#members.set(key, member);
				this.#attachRecorderFeed(member);
				this.#options.onStarted();
				if (seedToCurrent) member.runtime.seedTo(this.#options.currentMessageCount());
				remaining--;
			}
			if (remaining === 0) break;
		}
		return this.size > 0;
	}

	activeRuntimes(): AdvisorRuntime[] {
		return [...this.#members.values()].map(member => member.runtime).filter(runtime => !runtime.disposed);
	}

	agents(): Agent[] {
		return [...this.#members.values()].map(member => member.agent);
	}

	historyEntries(): Array<{ label: string; agent: Agent }> {
		return [...this.#members.values()].map(member => ({ label: member.key, agent: member.agent }));
	}

	forEachMember(callback: (member: AdvisorPoolMember) => void): void {
		for (const member of this.#members.values()) callback(member);
	}

	resetRuntimes(): void {
		for (const member of this.#members.values()) member.runtime.reset();
	}

	resetDeliveryState(): void {
		for (const member of this.#members.values()) {
			member.adviseTool.resetDeliveredNotes();
			member.emissionGuard.reset();
		}
	}

	detachRecorderFeeds(): void {
		for (const member of this.#members.values()) {
			member.unsubscribe?.();
			member.unsubscribe = undefined;
		}
	}

	attachRecorderFeeds(): void {
		for (const member of this.#members.values()) this.#attachRecorderFeed(member);
	}

	closeRecorders(): Promise<void> {
		return Promise.allSettled([...this.#members.values()].map(member => member.recorder.close())).then(() => {});
	}

	dispose(): void {
		this.detachRecorderFeeds();
		const closers: Promise<void>[] = [];
		for (const member of this.#members.values()) {
			member.runtime.dispose();
			closers.push(member.recorder.close());
		}
		this.#members.clear();
		if (closers.length > 0) {
			this.#recorderClosed = Promise.allSettled(closers).then(() => {});
		}
	}

	#profileMinInstances(profile: AdvisorProfile): number {
		const rawMin = profile.instances?.min ?? (profile.mode === "always" ? 1 : 0);
		if (!Number.isFinite(rawMin) || rawMin <= 0) return 0;
		return Math.trunc(rawMin);
	}

	#attachRecorderFeed(member: AdvisorPoolMember): void {
		member.unsubscribe?.();
		member.unsubscribe = member.agent.subscribe(event => {
			if (event.type === "message_end") member.recorder.record(event.message);
		});
	}
}
