# Gate 5 — Qwen read-only qualification

Local model: `qwen3.5:9b` through Ollama at `http://127.0.0.1:11434`. The tag is the published Qwen 3.5 9B model. It was not installed on this machine at the start of the gate, so it was pulled (6.6 GB) before the run.

`executeReadOnly` in `packages/agent-tools` allows `file.read`, `repo.search`, `git.status`, `git.diff`, `diagnostics.run`, and `browser.check`. `file.write`, `terminal.run`, and `tests.run` return `mutation_blocked` before the host runs. The qualification client does not import Code - OSS.

The fixture is `packages/qwen-qualify/fixture`: a tiny React UI kit named `badge-demo`, with the Badge component in `src/components/Badge.tsx`. The runner copies it to a temporary Git repository. The model does not create that repository.

## Run

```sh
sh scripts/qualify-qwen.sh
```

That runs the tool contract checks, then the six qualification tasks against the local model.

## Evidence

Recorded in `packages/qwen-qualify/out/qualification.json` at `2026-09-25T19:51:17.950Z`. Grade: `limited_agent`. The fixture copy was unchanged after the run.

| Check | Result |
|---|---|
| Connect | Pass. The model replied `pong`. |
| Identify project | Pass. Answer `badge-demo` after `file.read`. |
| Locate implementation | Pass. Answer `src/components/Badge.tsx` after `repo.search`. |
| Use search or read tools | Pass. Both of those answers used a repository tool. |
| Grounded plan | Fail. The model named no file and called no tool. It said it would read the Badge directory later. |
| Report tool failure | Pass. `file.read` of `src/missing.txt` returned `ok: false`, and the answer was `TOOL_FAILED`. |

The contract check `blocks file writes while read-only` also passed. The shell was launched on Code - OSS `1.139.1`. The extension host logged `CodeMe shell activated` and `CodeMe connection: limited_agent`. The window title was `[Extension Development Host] Welcome — CodeMe`. The status item reads `CodeMe: limited`. Explorer, editor, and terminal still open. File edits from the model stay off.

The durable run loop is recorded in `docs/GATE_5_AGENT_RUN.md`. Gate 6 is recorded in `docs/GATE_6_CONTROLLED_CODING.md`.
