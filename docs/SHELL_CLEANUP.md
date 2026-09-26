# Composer / IDE Shell Integration

The stock Chat tab is not opened. A workspace uses Explorer on the left, the native editor in the centre, and CodeMe Agent on the right. Composer submits a real AgentRun. Crash-safe recovery has not started.

Follow-up to `942f060`.

## Layout

Explorer | Editor | CodeMe Agent. The terminal stays in the bottom panel when it is open. Native sashes remain resizable. Opening a file does not hide CodeMe Agent.

The empty editor is a compact Start tab with Open File, Search Files, Open Terminal, and Ask CodeMe. The oversized watermark/logo is not used.

## Composer

- Enter sends. Shift+Enter inserts a newline. IME composition is ignored.
- Send is disabled while a run is in progress. Stop cancels the live AgentRun.
- The model menu is filled from `ModelProvider.listModels()`. The Ollama provider reads `/api/tags`. The selected value is persisted and becomes `requestedModel` / `effectiveModel`.
- Explorer drops use Code-OSS `ResourceURLs`. Multiple workspace files become structured attachment refs. File contents are not inlined. Paths outside the workspace are rejected (`path_escape`).
- Lifecycle lines stay human. Completion shows a short result, verification, and expandable file diffs.

## Live qualification (26 September 2026)

CodeMe was launched with `scripts/launch-codeme.sh` on `web testing` (`--disable-workspace-trust`). Screenshots are the CodeMe window only.

| Check | Result |
|---|---|
| Layout | Explorer left, `README.md` centre, CodeMe Agent right. Model `Qwen 3.5 9B`. No Chat. No giant logo. |
| Consecutive prompts, no reload | `run_be9ee2ee49ae5673` completed. `run_68b8a1e1551103cd` was a new id. `run_2867fbcc883fe11c` started after that. The first run's goal stayed `Name the project in one sentence from README.md.` |
| Model discovery | Only `qwen3.5:9b` is installed. `OllamaModelProvider.listModels()` returned that id from `/api/tags`. The selector label `Qwen 3.5 9B` is derived. The HTML has no hard-coded `qwen3.5:9b`. The completed run recorded `requestedModel` / `effectiveModel` / `persistentSelection` = `qwen3.5:9b`. |
| Explorer drop format | Code-OSS explorer uses `ResourceURLs`. Two workspace files became `README.md` and `package.json` on `run_5d6bb618a0036925`. The README body was not inlined. `/tmp/codeme-outside.txt` was `path_escape`. Removing one dropped attachment left a single chip. |
| Active / completed UI | Planning… and Stop on `run_be9ee2ee49ae5673`, then Complete naming CarBidDealership. |

## Screenshots

- `docs/shell-cleanup/01-empty-editor.png`
- `docs/shell-cleanup/02-source-open.png`
- `docs/shell-cleanup/03-agent-running.png`
- `docs/shell-cleanup/04-agent-complete.png`
- `docs/shell-cleanup/09-layout.png` — CodeMe window: Explorer, source, Agent, model selector
- `docs/shell-cleanup/12-prompt1-running.png` — active AgentRun
- `docs/shell-cleanup/13-prompt1-complete.png` — completed AgentRun

## Tests

```
node extensions/codeme-shell/test/panel.test.js
node extensions/codeme-shell/test/composer.test.js
node extensions/codeme-shell/test/preview-runner.test.js
node packages/agent-runtime/test/orchestration.test.js
node packages/agent-runtime/test/stagnation.test.js
node packages/agent-runtime/test/hardening.test.js
node packages/n8n-capability/test/foundation.test.js
node packages/n8n-capability/test/registry.test.js
```
