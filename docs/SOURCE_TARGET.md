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

Architecture documents only:

- `MASTER_BLUEPRINT.md` — execution plan for this repository
- `docs/CODEME_CODE_OSS_MIGRATION.md` — matches the donor file at the commit above
- `docs/AGENT_LOOP_HARDENING_SEQUENCE.md` — copied from that commit
- `docs/CODEME_STRATEGY_ENGINE.md` — copied from that commit
- `docs/SOURCE_TARGET.md` — this boundary

## Not present

- Donor application source (`src/`, `desktop/`, `packages/`, tests, and the rest of the donor tree)
- Other donor documents (server, desktop, n8n, ADRs). They stay in the donor until a later gate names them.
- Code - OSS. Bringing in and proving that baseline is Gate 1, which has not started.

## Gate

This commit is the Gate 0 checkpoint:

- architecture docs listed above are in the tree;
- the donor repository, branch, and commit are pinned;
- no donor application source is present;
- the work is on `migration/code-oss`, and `main` has no application tree.

Gate 1 (clean Code - OSS baseline) starts only after this checkpoint. Code - OSS is still not in the repository.
