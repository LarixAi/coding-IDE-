# Gate 5 — Durable AgentRun

Checked before any write, terminal, or test permission. The Composer now starts a real AgentRun. See `docs/COMPOSER_INTEGRATION.md`.

## Audit

Before this runtime, none of the AgentRun pieces below existed in executable code. `packages/qwen-qualify/run.js` called Ollama and `executeReadOnly` directly, kept no run record, and stopped after a fixed qualification script.

| Required piece | Runtime |
|---|---|
| AgentRun with a unique run id | `createRun` stores `run_<16 hex>` |
| Persisted run state | `RunStore` writes `id.json` by rename, and keeps the previous file |
| Original user goal | `run.goal` |
| Plan / subtasks | `understand`, `inspect`, `verify` with pending, in progress, completed, or blocked |
| Lifecycle | `created`, `running`, `awaiting_model`, `executing_tool`, `verifying`, `completed`, `cancelled`, `failed`, `interrupted` |
| Tool-call history | `run.toolCalls` |
| Observations | `run.observations`, also appended to the next model request |
| Files changed | `run.filesChanged`, left empty because writes cannot succeed |
| Verification | `run.verification`; a model answer with no supporting observation does not complete the run |
| Cancellation | `cancel()` aborts the model call; a cancelled run does not resume |
| Timeout | model call timeout becomes `error.code` `timeout` |
| Retry limit | `maxRetries` on an identical failing action |
| Repeated-action stop | `maxIdenticalActions`, including successful repeats |
| Failure state | `lifecycle` `failed` and `outcome.reason` |
| Model disconnection | connection refusal becomes `model_disconnected` |
| Recovery / resume | load the checkpoint; do not replay an in-flight tool; a finished run stays finished |
| Final outcome | `run.outcome` |
| Iterative loop | model decision, `registry.call`, observation, next decision, until verified completion, cancellation, a safety limit, or failure |

Qwen goes through `OllamaModelProvider`, which implements `ModelProvider`. `agent-run.js` does not name Ollama or port 11434. Tools go through `ToolRegistry` and `ReadOnlyToolProvider`. That provider calls `executeReadOnly`, so `file.write`, `terminal.run`, and `tests.run` return `mutation_blocked`.

`ExternalCapabilityProvider` lists nothing and returns `capability_unavailable`. No n8n client is implemented.

## Run

```sh
sh scripts/test-agent-run.sh
```

## Evidence

On this machine, 25 September 2026, that script exited 0 in about 31 seconds. Local model `qwen3.5:9b`.

- Run ids differ, and the original goal is stored.
- `agent-run.js` has no Ollama client. It calls `registry.call`.
- `file.write`, `terminal.run`, and `tests.run` return `mutation_blocked` and do not touch the host.
- The external capability hub returns `capability_unavailable`.
- A corrupt checkpoint loads the previous valid file.
- Cancellation ends `cancelled` with no tool execution, and resume does not continue it.
- A hanging model endpoint ends `failed` / `timeout`.
- A refused connection ends `failed` / `model_disconnected`.
- The same failing `file.read` stops after 2 executions with `repeated_action`.
- The same successful read stops after 2 executions with `repeated_action`.
- A run that keeps searching stops at 3 iterations with `iteration_limit`. Checkpoints included `awaiting_model` and `executing_tool`.
- After a saved `file.read`, resume completes from that observation and reads the file once. Resuming a completed run does not call the model again.
- A crash after the in-flight checkpoint does not call the tool again on resume.
- Qwen searched, read `src/components/Badge.tsx`, and a later model request contained `export function Badge`. The plan steps completed only after verification. `filesChanged` stayed empty.
- Qwen received `"ok":false` for `src/missing.txt` on a later model request and answered `TOOL_FAILED`.

The read-only grant stays closed. Gate 6 is recorded in `docs/GATE_6_CONTROLLED_CODING.md`.
