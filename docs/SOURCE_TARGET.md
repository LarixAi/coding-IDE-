# Source and target boundaries

Gate 0 record. This file states what may enter this repository. It is not the component inventory. That audit is Gate 2.

## Target

- Repository: `LarixAi/coding-IDE-`
- Role: clean CodeMe rebuild. Code - OSS is the IDE body. CodeMe keeps product identity, Composer, and the agent.
- Protected branch: `main`. Migration work stays off `main`.
- Working branch: `migration/code-oss`

## Donor

Reference only. Do not merge it into this repository.

| Field | Value |
|---|---|
| Repository | `LarixAi/code-companion-pro` |
| URL | https://github.com/LarixAi/code-companion-pro |
| Branch | `codeme/agent-loop-hardening` |
| Commit | `ee3f2c27c4476d611fdd0e19851df4827aa88557` |
| Commit date | 2026-09-25T18:16:40Z |
| Subject | docs: add n8n and Qwen IDE workflow guide |

Later gates must name this commit, or a newer pin recorded here, before copying anything else from the donor.

## Present in this repository

Architecture documents:

- `MASTER_BLUEPRINT.md` — execution plan for this repository
- `docs/CODEME_CODE_OSS_MIGRATION.md` — matches the donor file at the commit above
- `docs/AGENT_LOOP_HARDENING_SEQUENCE.md` — copied from that commit
- `docs/CODEME_STRATEGY_ENGINE.md` — copied from that commit
- `docs/SOURCE_TARGET.md` — this boundary
- `docs/GATE_1_BASELINE.md` — Code - OSS pin and baseline evidence
- `docs/MIGRATION_INVENTORY.md` — Gate 2 keep, transplant, rebuild, replace, and delete decisions
- `docs/GATE_3_SHELL.md` — minimal shell launch and evidence
- `extensions/codeme-shell/` — CodeMe theme, Composer view, and connection status
- `scripts/launch-codeme.sh` — starts that shell on the Code - OSS pin
- `packages/agent-tools/` — agent tool contract, independent of Code - OSS
- `extensions/codeme-shell/code-oss-host.js` — runs that contract on Code - OSS services
- `docs/GATE_4_TOOLS.md` — tool evidence
- `packages/qwen-qualify/` — local Qwen read-only qualification runner and fixture
- `docs/GATE_5_QUALIFICATION.md` — qualification evidence and grade
- `packages/agent-runtime/` — durable AgentRun, model provider, tool registry, and capability boundary
- `docs/GATE_5_AGENT_RUN.md` — AgentRun evidence; the default grant stays read-only
- `packages/coding-qualify/` — disposable coding fixture, workspace host, and Gate 6 runner
- `docs/GATE_6_CONTROLLED_CODING.md` — controlled coding evidence
- `packages/feature-qualify/` — disposable multi-file service, requirement checks, and Gate 7 runner
- `docs/GATE_7_MULTI_FILE_FEATURE.md` — multi-file feature evidence
- `packages/n8n-capability/` — n8n gateway. Gate 8 proved `hub.health`. The routed capabilities now also include `research.problem`, `knowledge.lookup`, and `task.decompose`. The hub does not receive the workspace.
- `docs/GATE_8_N8N_FOUNDATION.md` — n8n foundation evidence
- `docs/GATE_9_CAPABILITY_REGISTRY.md` — capability registry and name routing
- `docs/GATE_10_RESEARCH_ASSISTED_CODING.md` — research-assisted coding qualification
- `docs/GATE_11_AUTONOMOUS_HARDENING.md` — effective model lock, strategy, follow-ups, diagnosis, evidence completion

Code - OSS baseline, unmodified, as a submodule:

| Field | Value |
|---|---|
| Path | `code-oss/` |
| Upstream | https://github.com/microsoft/vscode.git |
| Release | `1.139.1` |
| Commit | `04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1` |

## Not present

- Donor application source (`src/`, `desktop/`, `packages/`, tests, and the rest of the donor tree), including the old Composer implementation
- Other donor documents (server, desktop, n8n, ADRs). They stay in the donor until a later gate names them.
- An agent loop inside the Composer view. The durable loop is `packages/agent-runtime`. Writes are limited to the Gate 6 qualification workspace.
- Specialist review, image generation, and deployment workflows. `ExternalCapabilityProvider` stays empty unless a hub is injected. The hub still cannot read or edit the workspace.

## Gate

Gate 0 is committed on `migration/code-oss` (`cb486bd`). `main` has no application tree.

Gate 1 baseline checks are recorded in `docs/GATE_1_BASELINE.md`. Gate 2 decisions are recorded in `docs/MIGRATION_INVENTORY.md`. Gate 3 is the extension in `extensions/codeme-shell/`. Gate 4 tools are recorded in `docs/GATE_4_TOOLS.md`. Gate 5 qualification is recorded in `docs/GATE_5_QUALIFICATION.md` with grade `limited_agent`. The durable AgentRun is recorded in `docs/GATE_5_AGENT_RUN.md`. Gate 6 is recorded in `docs/GATE_6_CONTROLLED_CODING.md`. Gate 7 is recorded in `docs/GATE_7_MULTI_FILE_FEATURE.md`. Gate 8 is recorded in `docs/GATE_8_N8N_FOUNDATION.md`. Gate 9 is recorded in `docs/GATE_9_CAPABILITY_REGISTRY.md`. Gate 10 is recorded in `docs/GATE_10_RESEARCH_ASSISTED_CODING.md`. Gate 11 is recorded in `docs/GATE_11_AUTONOMOUS_HARDENING.md`. No donor application source has been copied.
