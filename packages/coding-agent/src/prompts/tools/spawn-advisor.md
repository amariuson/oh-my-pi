Spawn a focused advisor, either one-shot or sticky.

Use when a narrow expert would catch mistakes the main model may miss: language review, complex logic, security-sensitive code, tests, prompts, UI polish, or unfamiliar domains.

Inputs:
- `focus` — REQUIRED. Exact question/risk for the advisor to review.
- `advisor` — OPTIONAL. Named profile from `ADVISORS.yaml` / `ADVISORS.yml`.
- `role` — OPTIONAL. Ad-hoc role when no named profile fits.
- `model` — OPTIONAL. Model role/spec allowed by user settings.
- `context` — OPTIONAL. `last_turn` (default) or `transcript`; use `transcript` only for cross-turn questions.
- `lifecycle` — OPTIONAL. `one_shot` (default) returns advice now; `sticky` stays alive across future turns.
- `risk` — OPTIONAL. For sticky advisors: `low` => 1 instance, `medium` => 2, `high` => 3 when `instances` is omitted.
- `instances` — OPTIONAL. Sticky instance count, clamped to 1-3 and existing dynamic/pool limits.
- `max_turns` — OPTIONAL. Sticky lease in primary turns; default 8, max 20.
- `timeout_seconds` — OPTIONAL. Sticky wall-clock lease; min 60, max 3600.

Rules:
- Use a named `advisor` when one matches.
- Use `lifecycle: "sticky"` when the same risk should be watched over several turns; otherwise keep `one_shot`.
- Use ad-hoc `role` for one-off expertise, e.g. `security reviewer`.
- NEVER spawn advisors speculatively. Name the concrete risk in `focus`.
- Advisors advise only: no edits, interrupts, approvals, commits, or pushes.
