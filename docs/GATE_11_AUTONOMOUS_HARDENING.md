# Gate 11 — Autonomous agent hardening

This is the rebuild-sequence name for blueprint Gate 8 in `MASTER_BLUEPRINT.md`. n8n already used Gates 8–10. AgentRun stays the runtime authority. The model still does not declare success.

## What landed

**Effective model lock.** `lockModel` records `requestedModel`, `effectiveModel`, and `persistentSelection` separately. A model that cannot use tools fails unless an explicit fallback is supplied. The fallback is stored on the run. The user's persistent selection is not changed. Every model call in the run uses the locked effective model.

**Automatic strategy selection.** `classifyTask` picks `inspect`, `bug-fix`, `feature`, or `general` from the goal, mode, and requirement count. `selectStrategy` attaches a versioned record. The guidance is injected into the system prompt. Manual `taskClass` is an override.

**Durable requirements and follow-ups.** When `inferRequirements` is set, the goal becomes an unverified requirement. `handle.followUp(text)` adds a requirement and a plan step, leaves verify pending, and appends a user message. The job is not restarted. Open requirements still block completion.

**Failure diagnosis.** Each failed tool observation gets a class: `provider`, `environment`, `permission`, `bad_code`, `wrong_command`, or `unknown`, plus a next step. A failing test is `bad_code` / `repair`. The class is stored on `run.diagnoses`.

**Evidence-based completion.** In controlled mode, `defaultVerify` rejects a write that is not followed by a later passing test and `git.diff`. Empty answers and runs with no observations still fail.

**Autonomy boundary.** Missing credentials (`credentials_required`) or a required approval (`approval_required`) pause the run at `awaiting_user`. A capability escalation is still refused in-process and the run continues, which is the Gate 9 contract.

**Already in AgentRun.** Persistent plan, context compaction of older duplicate observations, bounded retries, stall/loop detection, and interruption without replay were kept.

## Benchmarks

`packages/agent-runtime/test/hardening.test.js` proves:

| Scenario | Result |
|---|---|
| Model fallback | Requested `chat-only`, effective `tool-model`, persistent selection unchanged. |
| No fallback | `model_not_capable` fails the run. |
| Strategy | A failing-test goal selects `bug-fix` version 1. |
| Follow-up | A mid-run instruction adds `follow-up-1` and a later write satisfies it. |
| Repair | `npm test` fails, is diagnosed `bad_code`, a write repairs it, tests pass, diff is recorded, run completes. |
| Credentials hold | Writing `.env` without a token pauses at `awaiting_user`. |
| Interruption | Cancel stays cancelled on resume. |
| Evidence contract | A write plus “I am done” fails verification. |

## Proof

`sh scripts/qualify-hardening.sh` exited 0. It runs the hardening tests, anti-stagnation tests, Gate 6 policy, Gate 7 requirements, Gate 8 foundation, Gate 9 registry, and AgentRun orchestration including both live Qwen checks.

Reserved capabilities were not implemented.

## Stopped here

Blueprint Gate 9 (crash-safe recovery) has not started. Learning persistence and strategy promotion stay later.
