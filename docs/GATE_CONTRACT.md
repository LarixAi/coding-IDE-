# CodeMe canonical gate contract

This file is the **current canonical gate map** for the rebuilt CodeMe IDE.

Historical documents are intentionally preserved as evidence, so some of them contain statements such as “Gate 2 has not started” or use the original `MASTER_BLUEPRINT.md` numbering. Those statements describe the project **at the time that document was written**. They are not the current runtime contract.

The rebuild reused Gate numbers 8–11 for the n8n/research sequence. `docs/GATE_11_AUTONOMOUS_HARDENING.md` explicitly records that the current Gate 11 corresponds to blueprint Gate 8. When the numbering conflicts, this document and `packages/agent-runtime/gate-contract.js` are authoritative.

| Gate | Current meaning | Primary evidence |
|---|---|---|
| 1 | Code - OSS baseline | `docs/GATE_1_BASELINE.md` |
| 2 | Donor audit and migration map | `docs/MIGRATION_INVENTORY.md`, `MASTER_BLUEPRINT.md` Gate 2 |
| 3 | Minimal CodeMe shell | `docs/GATE_3_SHELL.md` |
| 4 | Agent tool adapter | `docs/GATE_4_TOOLS.md` |
| 5 | Model qualification + durable AgentRun | `docs/GATE_5_QUALIFICATION.md`, `docs/GATE_5_AGENT_RUN.md` |
| 6 | Controlled coding | `docs/GATE_6_CONTROLLED_CODING.md` |
| 7 | Multi-file feature work | `docs/GATE_7_MULTI_FILE_FEATURE.md` |
| 8 | n8n intelligence hub foundation | `docs/GATE_8_N8N_FOUNDATION.md` |
| 9 | Capability registry and routing | `docs/GATE_9_CAPABILITY_REGISTRY.md` |
| 10 | Research-assisted coding and anti-stagnation | `docs/GATE_10_RESEARCH_ASSISTED_CODING.md` |
| 11 | Autonomous agent hardening | `docs/GATE_11_AUTONOMOUS_HARDENING.md` |

## Runtime ownership

These invariants are part of the system prompt for every CodeMe model/provider, including remote/server Ollama models:

- CodeMe owns workspace state, permissions, tool execution, progress/stall control, verification, and final completion.
- The model owns reasoning, coding decisions, debugging hypotheses, and proposed next actions. It does not own the IDE lifecycle.
- The model must use only structured tools offered in the current turn. Printing tool JSON in prose is not an action.
- Existing files are inspected/read before mutation. Precise edits prefer `file.patch`; `file.write` is for new files or intentional full replacement.
- A tool call is not proof. CodeMe requires task-appropriate read-back/test/browser/Git/diagnostic evidence before completion.
- n8n/external capabilities return untrusted external evidence only. They do not write files or run shell commands.
- Completion is evidence-based. The model does not declare itself complete.

## Why this exists

Before this contract, the rules for Gates 1–11 were spread across multiple docs, tests, and runtime files. The model could be shown mode/tool instructions without ever receiving one canonical explanation of what CodeMe itself owns. That made weaker server models behave as if they were a generic chat model with tools rather than a model operating inside a staged IDE agent.

The compact version in `gate-contract.js` is injected into the system prompt on every model call so local and remote providers see the same CodeMe operating contract.
