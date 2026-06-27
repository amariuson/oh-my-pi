Spawn a one-shot reviewer with a focused role, then return structured advice.

Use when a narrow expert would catch mistakes the main model may miss: language review, complex logic, security-sensitive code, tests, prompts, UI polish, or unfamiliar domains.

Inputs:
- `focus` — REQUIRED. Exact question/risk for the advisor to review.
- `advisor` — OPTIONAL. Named profile from `ADVISORS.md` / `ADVISOR.md`.
- `role` — OPTIONAL. Ad-hoc role when no named profile fits.
- `model` — OPTIONAL. Model role/spec allowed by user settings.
- `context` — OPTIONAL. `last_turn` (default) or `transcript`; use `transcript` only for cross-turn questions.

Rules:
- Use a named `advisor` when one matches.
- Use ad-hoc `role` for one-off expertise, e.g. `security reviewer`.
- NEVER spawn advisors speculatively. Name the concrete risk in `focus`.
- This tool returns advice; it does not edit, interrupt, or approve actions.
