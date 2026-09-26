# Composer integration

A Composer message is an AgentRun. The extension does not plan, call tools, or retry on its own.

```
Composer → AgentRun → ModelProvider → installed model → CodeMe tools / n8n when needed → AgentRun events → Composer
```

The duplicate Composer chat loop and `extensions/codeme-shell/hub-panel.js` are gone. `ComposerSession` calls `startAgentRun`. Progress, cancellation, and the final record come from `RunStore` checkpoints.

## What the Composer does

Prompt input: Enter sends, Shift+Enter inserts a newline, and an IME composition (`isComposing` or key code 229) does not send. A second submit while a run is active is rejected. Stop calls `handle.cancel()` on that run. A failed, timed-out, or cancelled run clears the running state so the next message can be sent. Each submit has its own request id and epoch, and a checkpoint from an older request cannot replace the current one. A rejected send puts the unsent draft back. A successful send clears the prompt.

Model selection: the Composer asks Ollama for installed models and shows their labels. `qwen3.5:9b` is displayed as “Qwen 3.5 9B”. The selected provider and model id are stored in extension global state and passed to `startAgentRun` as `providerName` and `model`. The session does not hard-code a model. Another provider can be added by returning `{ provider, id, label }` from the model list and supplying a `ModelProvider` for that name.

Attachments: drag-and-drop, the Attach button, and remove are supported. A chip shows the file name, type, and size. At most 6 files, each at most 1 MB. A path outside the workspace is refused. Image, PDF, and folder attachments are reserved and refused. The goal receives JSON references only. The file body stays out of the prompt. The run reads what it needs through CodeMe tools.

Progress labels come from the run lifecycle and the in-flight tool: Waiting, Understanding, Planning, Searching, Reading, Editing, Testing, Researching, Fixing, Verifying, Complete, Failed, and Cancelled. Completion shows the outcome, changed files, verification, and an expandable diff when the run recorded one.

The Composer starts runs in `read_only` mode. Write, terminal, and test tools still return `mutation_blocked`. Editing and Testing appear when a run actually emits those tools.

## Checks

```sh
node extensions/codeme-shell/test/composer.test.js
node extensions/codeme-shell/test/panel.test.js
node packages/agent-runtime/test/stagnation.test.js
node packages/agent-runtime/test/orchestration.test.js
node packages/n8n-capability/test/foundation.test.js
node packages/n8n-capability/test/capabilities.test.js
node packages/n8n-capability/test/registry.test.js
```

On 26 September 2026 those commands exited 0. The scripted Composer test covers Enter, Shift+Enter, IME, a real `run_` id, switching the selected model into `ModelProvider.complete`, attachment references without file contents, path escape, live Reading from a checkpoint, cancel, failure, a following submit, and a stale request id. Anti-stagnation, AgentRun, and n8n registry tests stayed green. The live Qwen cases in `orchestration.test.js` also passed on the second run, after an earlier attempt timed out while another qualification was using the same model.

## Live CodeMe window

The desktop window was launched with the Composer extension and a temporary workspace, `/tmp/codeme-composer-ui`. Ollama had one installed model, `qwen3.5:9b`. Driving the Composer webview showed:

- The model menu contained “Qwen 3.5 9B”.
- Shift+Enter produced a newline (`a` then newline then `b`).
- Dropping `README.md` showed the chip `README.md · text/markdown · 29 B`.
- Removing the chip cleared it.
- Dropping a file outside the workspace showed “That file is outside the workspace.”
- Enter created `run_5a03b00c90448edf` with provider `ollama`, model `qwen3.5:9b`, and a JSON attachment reference. The file body `codeme-ui-anchor-not-inlined` was not in the goal.
- A typed message, “can you read the files”, completed as `run_4989df17076bef36`. Qwen called `repo.search` and `git.status`. Verification passed. The stored lifecycle moved through `awaiting_model`, `executing_tool`, `verifying`, and `completed`.
- Stop on the visible run `run_9bccef9d3fabfd16` saved lifecycle `cancelled` and left the prompt and send button usable.
- Further messages created new runs in the same window without restarting CodeMe.

Changing the live menu could not be exercised with a second installed model. The scripted session test selects `llama3.2:3b` after discovering `qwen3.5:9b`, and every model call in that run receives `llama3.2:3b`.

Gate 10 was not restarted.
