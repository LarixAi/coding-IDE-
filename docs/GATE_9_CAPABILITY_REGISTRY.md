# Gate 9 — n8n capability registry and routing

AgentRun still owns planning, execution, file writes, verification, and completion. n8n remains an external provider. The model asks for a capability by name. The adapter resolves that name to a workflow. AgentRun never sees the workflow path.

## Registry

`CapabilityRegistry` lives in `packages/agent-runtime/capability-registry.js`, beside `ExternalCapabilityProvider`. A record must contain `name`, `description`, `category`, `inputSchema`, `outputSchema`, `permissions`, `risk`, `timeout`, `availability`, `health`, `provider`, and `version`.

The catalog reserves `research.web`, `research.docs`, `code.lookup`, `code.debug`, `code.review`, `browser.inspect`, `image.generate`, and `deploy.verify`. Those names cannot be registered. There is no workflow behind them.

Names that discovery can register are the ones with a real workflow: `hub.health`, `research.problem`, `knowledge.lookup`, and `task.decompose`. A discovery entry is dropped when its schema is malformed, its risk is anything other than `read`, its permissions include a workspace tool, its category does not match the catalog, or its route does not match the adapter's route for that name. The public contract does not include `route` or a webhook path.

`capability.invoke` is offered only after discovery. A name that was not returned is rejected before any request is sent. A name outside the catalog is `unknown_capability`. A catalog name that discovery did not return is `capability_unavailable`. Input and output are checked against the record's schema. A response that names a command or `file.write` is `capability_escalation` and does not write a file. Hub failures stay on the run as untrusted observations.

## Proof

`sh scripts/qualify-registry.sh` runs the registry tests, the Gate 8 foundation tests, the Gate 6 policy tests, the Gate 7 requirement tests, the AgentRun orchestration tests, and both live hub calls.

Local n8n 2.40.7 discovered `hub.health`, `research.problem`, `knowledge.lookup`, and `task.decompose`. The `hub.health` contract was `read` risk, provider `n8n`, version 1, and it did not expose a route. AgentRun `run_b2c65447959e9e87` kept request `req_15947f7ecdeaf3ca`. The observation was `type: "capability"`, `trusted: false`, and `filesChanged` was empty. The Gate 8 Qwen round trip also passed again: `run_0c007ce8f68f3fa3` received marker `codeme-hub-ok`.

| Check | Result |
|---|---|
| Discovery | The public list contained only records the registry accepted. Future names, a write-risk record, a bad schema, an unknown name, and a substituted route were dropped. |
| Invented capability | `not.a.capability` returned `unknown_capability`. The health webhook received no request. The run completed. |
| Name routing | The adapter posted `/webhook/codeme-hub-health`. `agent-run.js` does not contain that path. The observation contained the marker and no webhook path. |
| Malformed response | HTML returned `malformed_response`. The run completed with `error: null`. |
| Repository writes | An input or response that named a command or `file.write` did not create a file. |
| Hub failure | A timeout and a closed port left the run `completed`. |
| Earlier gates | Gate 6 policy, Gate 7 requirements, Gate 8 foundation, and the AgentRun orchestration tests passed. |

The live record is `packages/n8n-capability/out/registry.json`.

## Stopped here

`research.web`, `code.lookup`, `code.debug`, `code.review`, `browser.inspect`, `image.generate`, and `deploy.verify` are catalog entries only. Gate 10 has not started.
