# CodeMe IDE

CodeMe IDE is being rebuilt on **Code - OSS** so CodeMe can keep its own product identity, Composer/agent experience and autonomous coding intelligence while relying on a mature IDE foundation for editing, workspaces, terminal, Git, language services and desktop lifecycle.

> **Core rule:** Keep the CodeMe brain and experience; use Code - OSS as the IDE body.

## Start here

Cursor or any coding agent working in this repository must read these files before implementation:

1. `MASTER_BLUEPRINT.md` — authoritative execution plan and phase gates.
2. `docs/CODEME_CODE_OSS_MIGRATION.md` — detailed Code - OSS migration specification.
3. `docs/AGENT_LOOP_HARDENING_SEQUENCE.md` — autonomous-agent reliability sequence.
4. `docs/CODEME_STRATEGY_ENGINE.md` — strategy/model qualification architecture.
5. `docs/MIGRATION_INVENTORY.md` — Gate 2 decisions for the donor. Do not copy a donor path that is classified REPLACE or DELETE.
6. `docs/GATE_3_SHELL.md` — how to launch the minimal CodeMe shell.
7. `docs/GATE_4_TOOLS.md` — the agent tool contract and how to test it.
8. `docs/GATE_5_QUALIFICATION.md` — local Qwen read-only qualification and the recorded grade.

## Current state

This repository intentionally starts clean. Do **not** copy the old CodeMe IDE wholesale into this repository.

Donor, pin, and what is allowed in this tree are recorded in `docs/SOURCE_TARGET.md`. Work continues on `migration/code-oss`. `main` stays free of migration experiments.

Current gate: **Gate 5 read-only qualification is recorded** in `docs/GATE_5_QUALIFICATION.md`. Local `qwen3.5:9b` connected and graded `limited_agent`. Run `sh scripts/qualify-qwen.sh`. The Code - OSS pin remains `1.139.1`. Gate 6, the first coding slice, has not started. Progress follows the gates in `MASTER_BLUEPRINT.md`. Each phase must be verified before the next begins.
