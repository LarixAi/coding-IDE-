# CodeMe Agent Loop Hardening Sequence

This document locks the implementation order for the `codeme/agent-loop-hardening` branch so reliability work is completed before adaptive learning is trusted.

## Principle

Do not train strategy selection from ambiguous execution data. CodeMe must first know exactly which provider/model executed every turn and why. CodeMe must also recover safely from crashes and maintain a durable understanding of the user's requirements throughout long autonomous runs.

## Phase 1 — Effective model lock (P0)
Goal: one authoritative effective Agent model per run.
- Preserve requested model separately from effective execution model.
- Validate Agent/tool capability before run start.
- Make fallback explicit, deterministic, recorded, and visible.
- Lock the effective model for the run instead of silently re-routing every turn.
- Use it consistently for calls, context length, metadata, diagnostics and outcome attribution.
- Do not silently change the user's persistent selection for a one-run fallback.
- Regression-test selected model, fallback, no-fallback failure and context-length lookup.

Current issue: `agent.ts` can replace a non-tool-capable selected model while `agent-session.ts` resolves a model again per turn; context lookup can still reference `input.model` rather than the actual turn model.

## Phase 2 — Automatic strategy selection (P0)
Goal: CodeMe chooses the engineering process automatically.
- Classify task once at Agent-run start.
- Select built-in/versioned strategy using task class and effective model profile.
- Inject `strategyGuidance()` through the strategy context slot.
- Record strategy ID/version/task class.
- Verification gates remain authoritative.
- Manual strategy selection is advanced override only.

## Phase 3 — AI execution-loop hardening (P0)
Goal: make the AI reliably understand, execute, diagnose and finish the user's actual request rather than merely producing code that compiles.

### 3.1 Prompt → requirements / acceptance criteria
- Convert the original request into explicit, durable requirements before substantial mutation.
- Preserve explicit user constraints verbatim where important; do not silently weaken them.
- Infer only low-risk implementation details. Ask only when a missing decision materially changes the product or creates risk.
- Maintain machine-readable acceptance criteria throughout the run.
- For vague large requests, inspect the repo before finalizing the execution plan.

### 3.2 Persistent execution plan
- Create a persistent plan for non-trivial work rather than generating an unrelated mini-plan every turn.
- Track steps as pending/in-progress/completed/blocked.
- Update the plan when evidence changes, a tool fails, or the user changes the request.
- Never mark a plan item complete merely because a model claimed it was complete.

### 3.3 Context management
- Build each model turn from the original request + active acceptance criteria + current strategy + current plan + relevant repo context + recent observations.
- Preserve critical decisions and constraints across long runs.
- Prefer retrieval/targeted reads over repeatedly injecting the entire repository/history.
- Summarize older tool observations when necessary without losing unresolved errors, requirements or decisions.
- Reserve context budget for tool results and repair turns.

### 3.4 Tool-result interpretation
- Distinguish `tool executed` from `engineering objective succeeded`.
- Parse diagnostics, tests, terminal exit state, browser console/network/visual QA and Git evidence into structured observations.
- Feed concise evidence back to the model, including what is confirmed, failed and still unknown.

### 3.5 Failure diagnosis before retry
- Classify failures before retrying: model/format, tool/runtime, bad code, wrong command, dependency/config, test regression, provider/network, environment, permission/approval, or unknown.
- Do not repeat an identical failed action without new evidence or a changed hypothesis.
- Use failure class to choose retry, inspect, repair, re-plan, fallback or user decision.
- Bound retries per failure/action.

### 3.6 Stall and loop detection
Detect and interrupt patterns such as:
- repeated identical tool calls
- repeated reads with no new hypothesis
- same failing command without relevant edits
- edit/revert/edit cycles
- repeated browser captures without source changes
- repeated model turns with no executable progress

When detected, force diagnosis/re-plan; if no safe progress is possible, report the blocker rather than consuming the run indefinitely.

### 3.7 Requirement tracking
- Reconcile completed work against the original request after meaningful milestones and before completion.
- New user follow-ups modify the active requirements/plan rather than becoming disconnected prompts.
- Explicitly track superseded requirements so old instructions do not reappear later.

### 3.8 Evidence-based completion contract
`done=true` is only accepted when relevant evidence supports completion:
- required acceptance criteria satisfied
- requested changes actually applied
- diagnostics/tests appropriate to the project pass or documented blockers are surfaced
- frontend/runtime work has relevant browser/runtime evidence
- no blocking console/network/visual QA failures
- actual changed-file diff has been reviewed
- no known unresolved blocking requirement remains

A model saying `done` is never completion evidence by itself.

### 3.9 Final self-review
Before successful completion:
- inspect `git.status`/`git.diff` where available
- identify unrelated accidental changes
- check placeholders/TODOs/stubs introduced by the run
- check removed functionality and obvious regressions
- compare final state to acceptance criteria
- produce the user-facing outcome from verified evidence, not model memory

### 3.10 User interruption and follow-up reconciliation
- Allow new user input during an active run.
- Merge follow-up constraints into the active requirements and plan.
- Cancel/supersede obsolete pending work.
- Re-verify affected completed steps when a follow-up invalidates previous assumptions.
- Never restart the whole job unnecessarily.

### 3.11 Autonomy boundary
Continue automatically for routine inspect/read/edit/test/debug/repair/verify actions. Pause for:
- genuinely ambiguous product decisions with materially different outcomes
- required credentials/access not available to CodeMe
- destructive/high-impact actions requiring existing approval policy
- external irreversible actions where confirmation is required
- blockers that cannot be resolved from repo/tool evidence

Normal users should not be asked to approve routine engineering steps.

## Phase 4 — Crash-safe session and workspace recovery (P0)
Goal: reopen as close as safely possible to the user's last working position.

Extend the existing checkpoint/recovery path rather than creating a second recovery system.

Persist/restore where available:
- project/workspace identity and binding
- conversation/chat history
- Agent run, original request, acceptance criteria and persistent plan
- requested/effective model, provider, task class and strategy
- completed turns/tool observations
- pending/accepted/rejected edits and changed-file state
- editor tabs/active file/cursor/layout where supported
- todos/follow-ups/verification state/diagnostics
- worktree/branch identity
- safe terminal metadata/history
- last safe checkpoint and in-flight operation

Checkpoint after meaningful transitions including model/strategy selection, plan updates, tool completion, applied edits, terminal completion, verification, follow-up reconciliation and terminal run state. Debounce high-frequency UI writes, version schemas, use replace-safe writes, and never persist credentials/secrets unnecessarily.

On recovery: reconcile durable state with real workspace/Git/filesystem/provider state; never blindly replay the in-flight action. File writes must be checked against disk. Commands, migrations, Git/deploy/external actions must be inspected before retry. Re-run stale verification. Resume with explicit confirmed/uncertain recovery context.

Recovery acceptance tests:
1. crash before first model response
2. crash after model response before tool execution
3. crash during/after file write
4. crash during terminal command
5. crash after edits before verification
6. crash during verification
7. crash with pending manual approval
8. crash with worktree active
9. corrupt latest checkpoint falls back to previous valid checkpoint
10. completed/cancelled run does not auto-resume

## Phase 5 — Verified outcome recording (P0)
Goal: trustworthy evidence for adaptation.
Record run/project/provider/requested model/effective model/fallback/task class/strategy/timestamps, verified and first-pass success, verification tools, final diagnostics, repair loops, tool failures, human interventions, terminal failure category, and whether recovery occurred.

## Phase 6 — Learning persistence (P1)
Goal: retain useful long-term experience across restarts. This is separate from crash recovery.
- Inspect current persistence/runtime patterns first.
- Use a local store appropriate to the runtime.
- Scope project lessons to project and model profiles to provider+model.
- Store structured metrics/generalized lessons, not secrets or unnecessary source copies.
- Version/migrate the schema.

## Phase 7 — Provider/model independence (P1)
Goal: provider-independent CodeMe Agent contract.
- Remove hard-coded rejection where an adapter satisfies the contract.
- CodeMe owns tools.
- Normalize provider responses.
- Qualify unknown models for connectivity, structured output, tools, repo context, controlled edits and verification/recovery.
- Classify Agent Ready / Limited Agent / Chat Only and degrade gracefully.

## Phase 8 — Benchmarks, promotion, rollback (P1)
Goal: improve only from repeated verified evidence.

Benchmark scenarios include bug fix, multi-file feature, UI visual verification, refactor/regression, API, DB/schema, deliberate failing test, tool recovery, long-running task, unknown-model qualification, interrupted-run recovery, vague-request acceptance criteria, mid-run requirement change, and repeated-failure re-plan.

Promotion requires repeated evidence, minimum threshold, improved verified success without worse interventions/tool failures, versioning and immediate rollback support. Never globally promote from one run/project.

## Required implementation order
`Effective model lock → automatic strategy selection → AI execution-loop hardening → crash-safe recovery → verified outcomes → learning persistence → provider independence → benchmarks/promotion/rollback`

Do not begin adaptive promotion before model attribution, execution-loop correctness, crash recovery and verification-backed outcomes are reliable.
