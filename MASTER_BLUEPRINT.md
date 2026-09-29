# CodeMe IDE — Master Migration Blueprint

> **Canonical current gate map:** the original blueprint numbering below is historical planning material. The implemented rebuild reused Gates 8–11 for n8n foundation, capability routing, research-assisted coding, and autonomous hardening. Use `docs/GATE_CONTRACT.md` as the authoritative current Gate 1–11 map.

## Mission

Rebuild CodeMe on a clean **Code - OSS** foundation without losing what makes CodeMe CodeMe.

- **Code - OSS owns:** editor, filesystem/workspaces, terminal/PTY, Git/SCM, language services, debugger, commands/keybindings and desktop lifecycle.
- **CodeMe owns:** product identity, Composer UX, agent orchestration, requirements/planning, tool contract, model/provider abstraction, verification, recovery, strategy and outcome learning.
- **Models own:** reasoning through CodeMe's controlled interfaces. Models do not own the IDE architecture or completion truth.

The donor/reference implementation is `LarixAi/code-companion-pro`, particularly the `codeme/agent-loop-hardening` branch. Do not blindly merge it into this repository.

## Non-negotiable working rules

1. Keep this repository buildable at every migration seam.
2. Work in migration branches; protect `main` from experiments.
3. Make small checkpoint commits with clear rollback points.
4. Never copy a legacy subsystem merely because it already exists. Classify it first as KEEP, TRANSPLANT, REBUILD, REPLACE or DELETE.
5. Preserve the current CodeMe UI as the design reference unless a deliberate redesign is approved.
6. Do not claim a phase complete because code compiles. Completion requires executable evidence.
7. Do not allow an AI model to declare its own work complete without verification evidence.
8. Keep provider/model code independent of Code - OSS wherever practical.
9. Keep the CodeMe agent-facing tool contract stable while swapping infrastructure underneath.
10. Stop and diagnose a failed phase instead of carrying broken architecture into the next phase.

---

# Execution sequence

## Gate 0 — Repository/bootstrap

**Goal:** establish a clean, documented migration workspace.

Required:
- this master blueprint and supporting architecture docs present;
- donor repository/branch recorded;
- no old CodeMe application copied wholesale;
- migration branch created before implementation work.

**Exit evidence:** clean repository state and documented source/target boundaries.

## Gate 1 — Clean Code - OSS baseline

**Goal:** prove the foundation independently of CodeMe and independently of AI.

Bring in/build the chosen Code - OSS baseline and verify:
- desktop app builds and launches;
- open a real folder/workspace;
- create/read/edit/rename/delete/save real files;
- native terminal starts with correct cwd/PATH/environment;
- stdin/stdout/stderr, exit status and cancellation work;
- long-running dev servers work;
- Git/SCM works;
- language diagnostics/navigation work;
- close/reopen restores workspace safely.

**Rule:** do not debug these failures in CodeMe code or blame the model. CodeMe is not integrated yet.

**Exit evidence:** reproducible baseline commands and verified native IDE workflow.

## Gate 2 — Donor audit and migration map

**Goal:** decide what crosses from old CodeMe before copying implementation.

Audit `LarixAi/code-companion-pro` and classify significant components:
- KEEP
- TRANSPLANT
- REBUILD
- REPLACE
- DELETE

Prioritise CodeMe UI reference under `src/components/codeme/`, design tokens/styles, agent/session logic, AI/provider abstractions, tool presentation/diff/recovery logic, protocol/harness packages and relevant tests.

Challenge/replace legacy infrastructure that Code - OSS already solves: custom editor/Monaco shell, workspace/filesystem bridges, terminal/process bridges, SCM, LSP and desktop lifecycle.

**Exit evidence:** committed migration inventory with file/component-level decisions and reasons.

## Gate 3 — Minimal CodeMe shell

**Goal:** make Code - OSS recognisably CodeMe without yet migrating the full product.

Implement only the minimum vertical UI shell:
- CodeMe product identity/branding;
- CodeMe theme/layout direction;
- native project/files explorer;
- native editor;
- native terminal;
- minimal CodeMe Composer/Agent panel;
- model/server connection status.

Composer default UX should stay simple. While working, show useful activity such as:
`Understanding → Planning → Editing → Testing → Fixing → Verifying → Complete`

Advanced detail can expand to show tool calls, diagnostics, retries and evidence. On completion, emphasise outcome, changed files and expandable diffs rather than internal chain-of-thought.

**Exit evidence:** CodeMe-branded desktop build using native Code - OSS IDE primitives.

## Gate 4 — CodeMe agent-to-IDE adapter

**Goal:** give CodeMe a stable tool contract backed by real Code - OSS services.

Preserve/define agent-facing tools such as:
- `file.read`
- `file.write`
- `repo.search`
- `terminal.run`
- `git.status`
- `git.diff`
- `diagnostics.run`
- `tests.run`

Add browser/runtime verification interfaces where relevant to frontend work.

The model must not depend on implementation details of Code - OSS. CodeMe owns validation, execution and structured tool results.

**Exit evidence:** deterministic integration tests proving tools operate on a real test workspace and return structured success/failure evidence.

## Gate 5 — Qwen read-only qualification

**Goal:** connect the initial local model without granting mutation until it demonstrates workspace understanding and tool discipline.

Initial target: local Qwen baseline (the migration specification currently names Qwen 3.5 9B; model selection may be updated deliberately without changing the architecture).

Read-only qualification:
1. connect successfully;
2. identify project type from repository evidence;
3. locate implementation of a requested feature/UI element;
4. use targeted file/search tools correctly;
5. produce a plan grounded in actual repository state;
6. handle a tool failure without inventing success.

**Exit evidence:** recorded qualification results. Failure degrades to Chat Only/Limited Agent rather than breaking the IDE.

## Gate 6 — First complete coding vertical slice

**Goal:** prove CodeMe can actually code, not merely generate code.

Required loop:
`understand → inspect → plan → edit → run → observe → diagnose → repair → verify → review diff → complete`

Qualification tasks, in increasing difficulty:
1. make one small controlled edit;
2. run build/test and report actual result;
3. diagnose and repair a deliberately introduced error;
4. complete a small feature without the user naming files;
5. inspect final Git diff and reconcile against original acceptance criteria.

**Exit evidence:** real project mutation plus command/test/diagnostic/Git evidence supporting completion.

## Gate 7 — Full CodeMe UX transplant

**Goal:** migrate the remaining CodeMe experience surface-by-surface after the coding loop is trustworthy.

For each surface capture and preserve its contract: layout, spacing, typography, colours, icons, states, keyboard behaviour, resize/collapse behaviour, model/server states, Composer activity and changed-file presentation.

Do not turn CodeMe into stock VS Code with a logo.

**Exit evidence:** intentional parity/approved changes documented per surface, with regression checks.

## Gate 8 — Autonomous agent hardening

**Goal:** make long-running work reliable.

Implement in this order:
1. effective model lock;
2. automatic deterministic strategy selection;
3. durable prompt → requirements/acceptance criteria;
4. persistent execution plan;
5. context management;
6. structured tool-result interpretation;
7. failure diagnosis before retry;
8. bounded retries and stall/loop detection;
9. requirement reconciliation and mid-run user changes;
10. evidence-based completion contract;
11. final Git/diff/self-review;
12. autonomy boundary for genuinely ambiguous/destructive/external actions.

See `docs/AGENT_LOOP_HARDENING_SEQUENCE.md`.

**Exit evidence:** benchmark tasks demonstrate repair, re-plan, interruption handling and evidence-backed completion.

## Gate 9 — Crash-safe recovery

**Goal:** resume safely after application/process failure.

Persist/reconcile project identity, conversation, request, acceptance criteria, plan, model/provider/strategy, completed observations, edit state, editor/workspace state, safe terminal metadata, verification state and last safe checkpoint.

Never blindly replay an in-flight action after recovery. Reconcile against filesystem/Git/provider reality first.

Run the recovery acceptance scenarios in the hardening document.

**Exit evidence:** repeatable crash/restart tests pass, including file-write, terminal, verification, approval and corrupt-checkpoint cases.

## Gate 10 — Verified outcomes and learning

**Goal:** learn only from trustworthy runs.

Record provider, requested/effective model, fallback, task class, strategy, verification evidence, repair loops, tool failures, interventions, failure category and recovery state.

Then add separate long-term persistence for project lessons and model profiles. Do not store secrets or unnecessary source copies.

**Exit evidence:** outcome records are attributable to the actual executing model and verified result.

## Gate 11 — Provider independence and qualification

**Goal:** make models interchangeable behind a CodeMe-owned contract.

Normalize provider responses and capability-probe unknown models for connectivity, structured output, tool use, repo context, controlled edits, verification and recovery.

Classify models as Agent Ready, Limited Agent or Chat Only and degrade gracefully.

**Exit evidence:** same benchmark/tool contract runs across multiple provider adapters without provider-specific IDE logic.

## Gate 12 — Benchmarks, strategy promotion and rollback

**Goal:** improve CodeMe from repeated verified evidence rather than guesses.

Benchmark at least bug fix, multi-file feature, UI visual verification, refactor/regression, API, database/schema, failing-test repair, tool recovery, long-running task, unknown-model qualification, interrupted recovery, vague-request acceptance criteria, mid-run requirement change and repeated-failure re-plan.

Strategies are versioned. Promote only after repeated evidence meets a defined threshold and does not worsen intervention/tool-failure/regression metrics. Preserve immediate rollback.

---

# Cursor execution protocol

When this repository is opened in Cursor, **do not ask Cursor to convert the whole IDE in one prompt**.

For every implementation task:
1. read this blueprint and relevant supporting doc;
2. identify the current gate;
3. inspect repository state before editing;
4. state concrete acceptance criteria;
5. keep scope bounded to the current gate;
6. implement in small coherent commits;
7. run the relevant build/tests/diagnostics/runtime checks;
8. inspect `git status` and `git diff`;
9. record verified evidence and unresolved blockers;
10. do not start the next gate until the current gate passes.

If a task fails repeatedly, stop repeating the same action. Classify the failure, gather new evidence, change the hypothesis or re-plan.

# Milestone 1 definition of done

Milestone 1 is complete only when CodeMe launches as a Code - OSS-based desktop application, looks recognisably like CodeMe, opens and modifies a real project, provides a functioning native terminal/Git/language environment, connects to the selected local Qwen model, and lets that model inspect a project, modify a file, execute a command, observe the real result, repair a failure and verify the outcome.

**Compilation alone is not completion. Evidence is required.**
