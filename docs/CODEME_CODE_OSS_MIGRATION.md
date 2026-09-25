# CodeMe → Code - OSS migration specification

## Objective

Preserve CodeMe's identity, UI/UX and autonomous-agent work while replacing custom IDE infrastructure with mature Code - OSS primitives where Code - OSS is stronger.

The finished product must look and behave like **CodeMe**, not like stock VS Code with a new logo.

Core rule: **Keep the CodeMe brain and experience; use Code - OSS as the IDE body.**

## Immediate priority

The first practical goal is to get CodeMe able to **code straight away** on top of a reliable desktop foundation:

1. open a real project;
2. inspect/search real files;
3. edit real files;
4. execute real shell commands;
5. receive real stdout/stderr and exit status;
6. inspect diagnostics and Git changes;
7. let a connected model inspect → plan → edit → run → observe → repair → verify.

Do not spend time perfecting advanced autonomous features before this vertical slice works.

## Migration rule

Do **not** blindly merge the current CodeMe repository into Code - OSS.

Audit first. For every significant component classify it as:

- **KEEP** — valuable and portable largely as-is.
- **TRANSPLANT** — move CodeMe code into the new foundation with adapters.
- **REBUILD** — preserve the visual/behavioural contract but implement it against Code - OSS APIs.
- **REPLACE** — Code - OSS already supplies a stronger primitive.
- **DELETE** — obsolete after migration; delete only after replacement is proven.

Keep the application buildable after each migration seam.

---

# 1. CodeMe UI/UX preservation inventory

The existing UI is already concentrated under `src/components/codeme/`. Treat these files as the primary visual reference for the migration.

## Preserve the CodeMe look/behaviour

| Current CodeMe surface | Current source | Migration intent |
|---|---|---|
| Overall IDE layout | `src/components/codeme/WorkspaceShell.tsx` | REBUILD against Code - OSS workbench while preserving CodeMe layout |
| Left activity/navigation | `src/components/codeme/ActivityBar.tsx` | TRANSPLANT/REBUILD |
| AI Composer / agent experience | `src/components/codeme/AgentPanel.tsx` | TRANSPLANT in stages; preserve UX, decouple from old IDE services |
| Model selection | `src/components/codeme/ModelSelector.tsx` | TRANSPLANT |
| Bottom panel presentation | `src/components/codeme/BottomPanel.tsx` | REBUILD around Code - OSS panel/terminal/problems services |
| Welcome/onboarding | `src/components/codeme/WelcomeScreen.tsx` | TRANSPLANT/REBUILD |
| Settings experience | `src/components/codeme/SettingsDialog.tsx` | TRANSPLANT/REBUILD |
| Status presentation | `src/components/codeme/StatusBar.tsx` | REBUILD using Code - OSS status services |
| AI server connection UX | `src/components/codeme/ConnectServerDialog.tsx` | KEEP/TRANSPLANT |
| Run/agent inspection | `src/components/codeme/RunInspector.tsx` | TRANSPLANT |
| Preview UX | `src/components/codeme/PreviewPanel.tsx` | TRANSPLANT/ADAPT |
| Command palette appearance/behaviour | `src/components/codeme/CommandPalette.tsx` | Prefer Code - OSS command infrastructure; preserve CodeMe UX where useful |
| Explorer appearance | `src/components/codeme/ExplorerPanel.tsx` | REBUILD around Code - OSS explorer/filesystem |
| Search appearance | `src/components/codeme/SearchPanel.tsx` | REBUILD around Code - OSS search |
| Source-control appearance | `src/components/codeme/ScmPanel.tsx` | REBUILD around Code - OSS SCM/Git |
| Editor appearance | `src/components/codeme/EditorArea.tsx` + `monaco-theme.ts` | REPLACE editor engine with Code - OSS editor; preserve CodeMe theme/visual decisions |
| Terminal appearance | `src/components/codeme/XtermPane.tsx` | REPLACE terminal engine with Code - OSS terminal; preserve CodeMe presentation where practical |
| Reusable CodeMe primitives | `src/components/codeme/primitives.tsx` | KEEP/TRANSPLANT selectively |
| Shared styling | `src/styles.css` | Preserve as visual reference; extract CodeMe design tokens |

Supporting generic UI primitives under `src/components/ui/` may be reused where they remain appropriate, but should not force a parallel UI framework into Code - OSS if native workbench primitives are cleaner.

## Visual preservation requirement

Before replacing any current CodeMe UI surface, capture its contract:

- layout and panel positions;
- dimensions/spacing;
- typography;
- colours and theme tokens;
- icons;
- hover/focus/selected states;
- empty/loading/error states;
- keyboard behaviour;
- resize/collapse behaviour;
- model/server connection states;
- Composer activity states;
- changed-file presentation.

The target is visual and behavioural parity where the existing design is intentional. Migration is not permission to redesign CodeMe into stock VS Code.

---

# 2. CodeMe intelligence to preserve

These areas contain CodeMe-specific value and should be preserved/adapted rather than discarded simply because the IDE foundation changes:

- `src/store/agent.ts`
- `src/store/agent-session.ts`
- `src/lib/agent/**`
- `src/lib/agent/strategy/**`
- `src/lib/ai/**`
- `src/lib/codeme/tool-presentation.ts`
- `src/lib/codeme/diff.ts`
- `src/lib/codeme/session-recovery.ts`
- `packages/harness-core/**`
- `packages/harness-qwen/**`
- `packages/model-providers/**`
- `packages/protocol/**`
- relevant agent/e2e qualification tests.

These will need adapters so the agent uses Code - OSS services rather than old web/Electron abstractions.

---

# 3. Infrastructure to challenge, not automatically migrate

The following areas overlap strongly with capabilities Code - OSS already provides and must be audited before any transplant:

- `desktop/electron/**`
- `src/lib/desktop/**`
- `src/lib/workspace/**`
- `src/store/workspace.ts`
- `src/store/editor.ts`
- `src/store/terminal.ts`
- `src/store/scm.ts`
- custom Monaco/LSP integration under `src/lib/lsp/**`
- old process/terminal bridges and daemon paths where Code - OSS can own the local execution environment.

Default preference: use Code - OSS for editor, filesystem/workspaces, terminal/PTY/process lifecycle, Git/SCM, language services, debugger, commands, keybindings and desktop lifecycle. Keep a CodeMe abstraction only where it provides a stable agent-facing contract or genuine product-specific behaviour.

---

# 4. Implementation phases

## Phase A — Prove clean Code - OSS

Before CodeMe changes, prove a clean checkout can:

- build and launch as a desktop application;
- open a real folder;
- create/read/edit/rename/delete/save files;
- launch a real terminal with correct cwd/PATH/environment;
- handle stdin/stdout/stderr, exit codes and cancellation;
- support long-running development servers;
- use Git/SCM;
- provide language diagnostics/navigation;
- close/reopen and restore the workspace.

This is the baseline. Do not blame CodeMe or the model for failures here.

## Phase B — Create the migration map

Audit the current CodeMe tree and record KEEP / TRANSPLANT / REBUILD / REPLACE / DELETE decisions. Do not delete old implementations yet.

## Phase C — Minimal CodeMe shell

Create the smallest CodeMe-branded Code - OSS build with:

- CodeMe product identity;
- recognisable CodeMe theme/layout;
- project/files;
- editor;
- terminal;
- minimal CodeMe Composer/Agent panel;
- model connection/status.

Do not migrate every settings page or advanced panel yet.

## Phase D — Agent-to-native-IDE adapter

Keep stable CodeMe agent tool contracts such as:

- `file.read`
- `file.write`
- `repo.search`
- `terminal.run`
- `git.status`
- `git.diff`
- `diagnostics.run`
- `tests.run`

but implement them over real Code - OSS services where appropriate.

The model should not need to know whether the underlying editor is old CodeMe or Code - OSS.

## Phase E — Qwen 3.5 9B baseline

Connect the local Qwen 3.5 9B model and qualify the vertical slice in increasing difficulty:

1. identify the project from repository files;
2. locate the implementation of a UI element;
3. make one small edit;
4. run the build/test and report real results;
5. diagnose and fix a deliberately introduced error;
6. complete a small feature without the user identifying files;
7. inspect the final diff and verify the result.

Expected loop:

`understand → inspect → plan → edit → run → observe → diagnose → repair → verify → complete`

## Phase F — Full CodeMe UX transplant

Once the coding loop works, migrate the remaining CodeMe UX surface by surface. Preserve the current visual identity and behaviour unless a deliberate product decision says otherwise.

## Phase G — Autonomous-core hardening

Re-scope `docs/AGENT_LOOP_HARDENING_SEQUENCE.md` after the Code - OSS foundation is proven. Remove/reclassify foundation problems Code - OSS solves and continue CodeMe-specific work: requirements, state machine, strategy, progress accounting, failure diagnosis, requirement-to-evidence verification, recovery, rollback, model independence and outcome learning.

---

# 5. Milestone 1 definition of done

Milestone 1 is complete only when:

> CodeMe launches as a Code - OSS-based desktop application, looks recognisably like the existing CodeMe, opens and modifies a real project, provides a functioning native terminal/Git/language environment, connects to Qwen 3.5 9B, and lets the model inspect a project, modify a file, execute a command, observe the real result, repair a failure and verify the outcome.

No false completion: each item needs executable evidence.

---

# 6. Cursor / paid-model usage policy

To conserve paid credits:

- use Cursor for bounded implementation milestones and difficult build/runtime problems;
- do architecture, acceptance criteria and migration decisions before invoking expensive models;
- do not ask Cursor to "convert the whole IDE" in one run;
- require each Cursor task to have explicit files/scope, acceptance criteria and verification;
- as soon as Qwen 3.5 9B can safely inspect/edit/run/debug, move suitable small tasks to Qwen;
- reserve stronger paid models for failures the local baseline cannot resolve efficiently.

The goal is not merely to save credits. It is to prove CodeMe can increasingly help build CodeMe.

---

# 7. Non-negotiable migration constraints

1. Do not touch `main` for migration experiments.
2. Do not delete the existing working CodeMe UI before the replacement surface is verified.
3. Do not redesign the product merely to match stock VS Code.
4. Do not maintain two permanent competing implementations of editor/terminal/filesystem/Git without a documented reason.
5. Do not call the migration successful because it compiles; verify real user and agent workflows.
6. Keep model/provider logic independent of Code - OSS wherever practical.
7. Keep the agent-facing tool contract stable while swapping infrastructure underneath.
8. Preserve rollback points and small commits at each migration seam.
9. Treat current CodeMe UI source as the authoritative design reference until a deliberate redesign is approved.
10. First priority is a reliable coding vertical slice, not feature count.
