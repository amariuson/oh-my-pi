---
name: creating-advisors
description: Create or update Oh My Pi advisor rosters and spawn focused reviewers. Use when adding ADVISORS.yaml profiles, choosing always vs triggered advisors, or spawning one-shot/sticky advisors.
---

# Creating Advisors

Create focused reviewers without expanding the main agent's responsibilities.

## When to use

- User asks to create, add, tune, or explain advisors.
- Project needs reusable reviewer roles in `.omp/ADVISORS.yaml`.
- A task needs `spawn_advisor` for a concrete review risk.
- Someone mixes roster YAML with spawn-only lease settings.

## Advisor types

| Type | Source | Lifetime | Use for |
| --- | --- | --- | --- |
| Roster profile | `.omp/ADVISORS.yaml` / `ADVISOR.yaml` | Reusable | Named project review roles |
| One-shot spawn | `spawn_advisor` | One tool call | Narrow question now |
| Sticky spawn | `spawn_advisor` with `lifecycle: "sticky"` | Future turns until retired/leased out | Ongoing risk watch |

Advisors advise only. They NEVER edit, interrupt, approve, commit, push, or spawn other advisors.

## Roster YAML contract

Write project rosters at `.omp/ADVISORS.yaml` unless the user explicitly asks for `ADVISOR.yaml`.

Supported profile fields only:

```yaml
advisors:
  correctness:
    label: Correctness reviewer
    description: Finds correctness bugs in stateful and exported behavior.
    model: slow
    when: exported APIs, parser changes, state machines, async control flow
    mode: triggered
    instances:
      min: 0
      max: 1
    prompt: Find concrete correctness bugs; missed callsites, stale state, races, bad defaults, unsafe migrations, incomplete cleanup, and edge cases that break observable behavior. Cite exact evidence.
```

Field rules:

- `prompt` is REQUIRED.
- `label` is OPTIONAL display text.
- `description` is RECOMMENDED for discovery quality.
- `model` is a hint only; must match `advisor.dynamic.allowedModels`.
- `when` describes routing triggers; keep concrete.
- `mode: always` defaults `instances.min` to `1` when omitted.
- `mode: triggered` defaults `instances.min` to `0` when omitted.
- `instances.min` starts that many persistent advisors.
- `instances.max` is a routing cap hint, not fan-out.
- `advisor.pool.maxInstances` caps total persistent roster advisors.

NEVER put spawn-only fields in roster YAML:

- `lifecycle`
- `risk`
- `max_turns`
- `timeout_seconds`

## Discovery

Roster lookup order:

1. user level: `<active agent dir>/ADVISORS.yaml` or `ADVISOR.yaml`
2. project levels, ancestor-to-leaf: `<dir>/.omp/ADVISORS.yaml` or `ADVISOR.yaml`

Project rosters require `advisor.dynamic.useProjectAdvisors: true`.

## Designing a profile

Checklist:

1. Name the failure class, not a generic persona.
2. Pick `mode: always` only for continuous project-wide risk.
3. Pick `mode: triggered` for specialist reviews.
4. Keep `prompt` dense, operational, evidence-seeking.
5. Avoid overlapping profiles that review the same risk.
6. Use `model: smol` for cheap text/UI/test review.
7. Use `model: advisor` for general code/prompt critique.
8. Use `model: slow` for correctness/security/architecture risk.

Good profile:

```yaml
advisors:
  migrations:
    description: Reviews schema/data migrations before they land.
    model: slow
    when: migrations, data backfills, compatibility changes, destructive cleanup
    mode: triggered
    instances:
      min: 0
      max: 1
    prompt: Review migration safety. Check rollback path, idempotency, backwards compatibility, data-loss risk, lock duration, and incomplete cleanup. Cite exact files and failure modes.
```

Bad profile:

```yaml
advisors:
  smart-helper:
    mode: always
    prompt: Help with anything and make the code better.
```

Problems: vague trigger, no description, unbounded scope, no concrete evidence contract.

## Spawning advisors

Use `spawn_advisor` when a concrete risk exists.

One-shot named profile:

```json
{
  "advisor": "correctness",
  "focus": "Review the parser change for missed malformed-input cases and stale callsites.",
  "context": "last_turn"
}
```

One-shot ad-hoc role:

```json
{
  "role": "security reviewer",
  "focus": "Check this token refresh flow for leaked credentials and replay risk.",
  "context": "transcript"
}
```

Sticky named profile:

```json
{
  "advisor": "prompts",
  "focus": "Watch prompt edits for authority ambiguity and prompt/code boundary mistakes until the refactor is complete.",
  "lifecycle": "sticky",
  "instances": 1,
  "max_turns": 6,
  "timeout_seconds": 1200
}
```

Sticky risk-based fanout:

```json
{
  "role": "release safety reviewer",
  "focus": "Watch release-script edits for destructive commands, skipped verification, and versioning mistakes.",
  "lifecycle": "sticky",
  "risk": "high"
}
```

Spawn rules:

- Use named `advisor` when a profile matches.
- Use `role` only when no profile fits.
- Use `context: "transcript"` only for cross-turn questions.
- Use sticky lifecycle only for continuing risk.
- NEVER spawn advisors speculatively.
- Focus MUST name the exact risk/artifact.

## Updating an existing roster

1. Read `.omp/ADVISORS.yaml` and nearby docs first.
2. Preserve unrelated profiles exactly.
3. Add the smallest profile that covers the gap.
4. Remove duplicate or vague profiles instead of stacking reviewers.
5. Run focused parser/profile tests if code changed.
6. For roster-only changes, verify YAML parses and skill discovery can see this skill.

## Verification

For roster-only edits:

- Parse the YAML with the project parser or `bun` YAML parser.
- Confirm fields are from the supported roster contract.
- Confirm no spawn-only fields appear in profiles.

For code changes:

- Run `bun run check` in `packages/coding-agent`.
- Run focused advisor tests, usually `bun test src/advisor/__tests__/profiles.test.ts`.

## Critical

- Roster YAML fields: `label`, `description`, `model`, `when`, `mode`, `instances`, `prompt`.
- Spawn-only fields: `lifecycle`, `risk`, `max_turns`, `timeout_seconds`.
- Advisors advise only: no edits, interrupts, approvals, commits, pushes, or recursive spawns.
