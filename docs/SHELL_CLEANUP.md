# Composer / IDE Shell Integration

The stock Chat tab is not opened. A workspace uses Explorer on the left, the native editor in the centre, and CodeMe Agent on the right. Composer submits a real AgentRun. Crash-safe recovery has not started.

## Layout

Explorer | Editor | CodeMe Agent. The terminal stays in the bottom panel when it is open. Native sashes remain resizable. Opening a file does not hide CodeMe Agent.

The empty editor is a compact Start tab with Open File, Search Files, Open Terminal, and Ask CodeMe. The oversized watermark/logo is not used.

## Composer

- Enter sends. Shift+Enter inserts a newline. IME composition is ignored.
- Send is disabled while a run is in progress. Stop cancels the live AgentRun.
- The model menu lists installed Ollama models. The selected value is persisted and becomes `requestedModel` / `effectiveModel` on the run.
- Attachments are workspace-bounded references (name, type, size). Contents are not inlined into the prompt.
- Lifecycle lines stay human: Understanding, Planning, Searching, Reading, Editing, Testing, Researching, Fixing, Verifying. Completion shows a short result, verification, and expandable file diffs.

## Live qualification

On 26 September 2026, CodeMe was launched with `scripts/launch-codeme.sh` on the `web testing` workspace (`--disable-workspace-trust`).

| Check | Result |
|---|---|
| Only CodeMe Agent on the right | Pass. No stock Chat tab. |
| Enter sends exactly once | Pass. `run_fd85f9cf77ada416` created from one Enter. |
| Shift+Enter inserts a newline | Pass. `line one` / `line two` stayed in the composer. |
| Real AgentRun ID | `run_ec576a1d9cb01342` then `run_fd85f9cf77ada416`. |
| Selected model used | `qwen3.5:9b` for `requestedModel`, `effectiveModel`, and `persistentSelection`. Provider `ollama`. |
| File attach + chip | `README.md · text/markdown · 186 B`. |
| Attachment removal | Chip cleared after ×. |
| Stop cancels AgentRun | `run_ec576a1d9cb01342` reached `lifecycle: cancelled` with `cancelRequested: true`. |
| Lifecycle events | Planning, Searching, Reading, then Complete. No raw JSON. |
| Explorer / editor / terminal | Native tools stayed usable. Terminal remained at the bottom. |
| Opening a file keeps Agent | README stayed beside CodeMe Agent. |
| Sidebar resizing | Native sashes unchanged. |
| Second prompt after completion | After cancel + reload, Enter created `run_fd85f9cf77ada416`, which completed. |
| Empty editor | Start tab with CodeMe actions. No giant logo. |
| Gate 11 / n8n tests | `hardening`, `stagnation`, `foundation`, and `registry` exited 0. |

Completed run `run_fd85f9cf77ada416` read `README.md` and named the project CarBidDealership. Verification passed from recorded observations.

## Screenshots

- `docs/shell-cleanup/01-empty-editor.png`
- `docs/shell-cleanup/02-source-open.png`
- `docs/shell-cleanup/03-agent-running.png`
- `docs/shell-cleanup/04-agent-complete.png`
- `docs/shell-cleanup/05-shift-enter.png`
- `docs/shell-cleanup/06-cancelled.png`
- `docs/shell-cleanup/07-attachment-chip.png`
- `docs/shell-cleanup/08-attachment-removed.png`

## Tests

```
node extensions/codeme-shell/test/panel.test.js
node extensions/codeme-shell/test/composer.test.js
node extensions/codeme-shell/test/preview-runner.test.js
node packages/agent-runtime/test/stagnation.test.js
node packages/agent-runtime/test/hardening.test.js
node packages/n8n-capability/test/foundation.test.js
node packages/n8n-capability/test/registry.test.js
```
