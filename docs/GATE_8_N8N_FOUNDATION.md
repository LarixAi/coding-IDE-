# Gate 8 — n8n intelligence hub foundation

n8n is an external capability hub. CodeMe still owns the run.

CodeMe owns AgentRun, task state, plans, requirements, workspace permissions, file operations, terminal execution, Git, diagnostics, tests, verification, model selection, and final completion. Qwen owns reasoning, coding decisions, debugging, and proposed next actions. n8n owns external capabilities. The only capability implemented here is `hub.health`, a deterministic echo. Research, retrieval, specialist review, image generation, deployment, and autonomous external actions are not implemented.

`packages/agent-runtime` talks to an `ExternalCapabilityProvider`. It does not name n8n, open its port, or import the adapter. `packages/n8n-capability` implements that interface and is the only place that calls the hub.

## Protocol

Requests use protocol version 1 and contain `requestId`, `runId`, `capability`, `input`, `context`, `timeout`, and `protocolVersion`. Responses contain `requestId`, `status` (`ok`, `error`, or `unavailable`), `data` and `evidence`, `sources`, `warnings`, `error`, `duration`, and `protocolVersion`.

CodeMe creates the request id and selects the context. Context and input are capped at 4000 characters. A response over 32000 characters is rejected, and evidence over 16000 characters is dropped. Keys that would carry a repository dump or a shell command (`repository`, `files`, `workspace`, `tree`, `filesystem`, `contents`, `command`, `shell`, and the same names nested inside the context) are rejected before any request is sent.

The reserved names are `research.problem`, `research.docs`, `research.github`, `knowledge.lookup`, `task.decompose`, `review.code`, `review.security`, `job.start`, `job.status`, and `hub.health`. Discovery returns only names the hub reports and the adapter can route. AgentRun does not contain that list or any webhook path. The routed workflow is `hub.health`.

A capability result is stored as an observation with `type: "capability"` and `trusted: false`. Native tool results stay `type: "tool"` and `trusted: true`. The same JSON is appended to the model transcript, so the next turn can read it. A hub failure is that observation. It does not reject the run promise or clear the checkpoint.

## Hub

The endpoint comes from `CODEME_N8N_URL`, defaulting to `http://127.0.0.1:5678`. A token comes from `CODEME_N8N_TOKEN` and is sent as `X-CodeMe-Token`. `.env.example` has an empty token. `.env` is gitignored. Logs record request id, run id, capability, status, and duration. They do not record the token, the input, or the response body.

Connection status is `GET /healthz`. Discovery is `POST /webhook/codeme-capabilities`. Health is `POST /webhook/codeme-hub-health`. The workflow definitions are `packages/n8n-capability/workflows/capabilities.json` and `packages/n8n-capability/workflows/hub-health.json`. Both answer with the protocol JSON. The health workflow returns `marker: "codeme-hub-ok"` and echoes `input.echo`. It does not receive the workspace.

Calls time out from the request `timeout`, abort when the run signal aborts, and retry a connection failure or an HTTP 5xx. Timeouts, malformed bodies, and 4xx responses are not retried. An unreachable hub returns `capability_unavailable`.

## Proof

`sh scripts/qualify-n8n.sh` runs the foundation tests, the Gate 6 policy tests, the Gate 7 requirement tests, and the live hub call. The local hub was n8n 2.40.7. `/healthz` returned `{"status":"ok"}`.

| Check | Result |
|---|---|
| Discovery | The live hub listed `hub.health`. A fixture that also advertised `research.docs` was filtered out because that workflow is not routed. |
| Call through the abstraction | `run_live_probe` / `req_9cd9700be02bceea` returned status `ok` and marker `codeme-hub-ok`. |
| Correlation | Agent run `run_880e0c4a68850748` kept request `req_c2f096413242f93c` on the observation. A mismatched request id was rejected. |
| Observation | The result is `type: "capability"`, `trusted: false`, `ok: true`. |
| Next model turn | Qwen 3.5 9B received that tool message on the following `complete` call. `receivedObservation` and `replyIncludedMarker` are true. The goal did not contain the marker. |
| Malformed response | HTML was rejected with `malformed_response`. The run completed. |
| Timeout and unavailable hub | A hanging server returned `timeout`. A closed port returned `capability_unavailable`. Both runs completed with `error: null`. |
| Workspace boundary | A hub payload that named `file.write` and `rm -rf /` caused no write. The adapter does not spawn a process or write a file. |
| Secrets | The test token was absent from logs and from committed files. `.env` is not tracked. |
| Local coding without the hub | Gate 6 policy tests, Gate 7 requirement tests, and the AgentRun orchestration tests passed. The empty provider still lists nothing and returns `capability_unavailable`. A scripted controlled run wrote `note.txt` with no capability tools offered. Full Qwen replays of the Gate 6 and Gate 7 fixtures were not repeated in this gate. |

The live record is `packages/n8n-capability/out/foundation.json`.

## Stopped here

`hub.health` is the only workflow. The blueprint's autonomous-hardening gate has not started.
