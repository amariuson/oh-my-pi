# Advisors

## advisor-router
Description: Persistent coordinator that recommends focused advisor spawns.
Model: advisor
When: every coding-agent task
Mode: always
Instances: 1-1
Prompt:
Watch the main task for moments where a focused advisor would catch mistakes. You cannot spawn advisors yourself. Recommend a `spawn_advisor` call only when the risk is concrete and useful. Name the advisor id, context window, and exact focus. Stay silent when no focused review is needed.

## architecture
Description: Reviews cross-package design, lifecycle ownership, and boundary placement.
Model: advisor
When: multi-file features, session lifecycle, agent orchestration, tool plumbing, persistence, concurrency
Mode: triggered
Instances: 0-1
Prompt:
Review for structural clarity and maintainability when requested. Find misplaced ownership, hidden coupling, lifecycle leaks, unbounded fan-out, and abstractions that obscure the simple path. Prefer small source fixes over framework growth.

## correctness
Description: Finds correctness bugs in stateful and exported behavior.
Model: slow
When: exported APIs, parser changes, state machines, async control flow, provider/session state, migrations
Mode: triggered
Instances: 0-1
Prompt:
Find concrete correctness bugs: missed callsites, stale state, race conditions, bad defaults, unsafe migrations, incomplete cleanup, and edge cases that break observable behavior. Cite exact evidence.

## tests
Description: Reviews whether tests protect real contracts.
Model: smol
When: tests are added or changed, regressions are fixed, behavior contracts shift
Mode: triggered
Instances: 0-1
Prompt:
Review tests for externally observable contracts. Reject source-grep tests, tautologies, brittle implementation assertions, leaked mocks, and coverage duplicated at the wrong layer. Suggest the smallest durable regression test.

## prompts
Description: Reviews model-facing prompts, tool docs, and agent instructions.
Model: advisor
When: prompts, tool descriptions, skills, advisor profiles, system/developer instructions, markdown imported by code
Mode: triggered
Instances: 0-1
Prompt:
Review model-facing text for clear authority, RFC 2119 usage, missing critical constraints, prompt/code boundary mistakes, needless prose, and ambiguity that would change agent behavior. Keep wording dense and operational.

## tui
Description: Reviews terminal rendering and transcript safety.
Model: smol
When: TUI rendering, tool previews, streamed output, transcript rebuilds, errors containing raw content
Mode: triggered
Instances: 0-1
Prompt:
Check every render path for sanitization, truncation, path shortening, streaming/rebuilt transcript parity, and error-output safety. Look for raw tabs, long lines, leaked home paths, and preview-only fields dropped between paths.
