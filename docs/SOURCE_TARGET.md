# Source and target boundaries

Gate 0 record. This file states what may enter this repository. It is not the component inventory. That audit is Gate 2.

## Target

- Repository: `LarixAi/Code-me-IDE-C.`
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
- An agent loop or a connected model

## Gate

Gate 0 is committed on `migration/code-oss` (`cb486bd`). `main` has no application tree.

Gate 1 baseline checks are recorded in `docs/GATE_1_BASELINE.md`. Gate 2 decisions are recorded in `docs/MIGRATION_INVENTORY.md`. Gate 3 is the extension in `extensions/codeme-shell/`, launched with `scripts/launch-codeme.sh`. No donor application source has been copied. Gate 4 has not started.
