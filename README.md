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
9. `docs/GATE_5_AGENT_RUN.md` — durable AgentRun runtime. The default grant stays read-only.
10. `docs/GATE_6_CONTROLLED_CODING.md` — controlled coding qualification on a disposable fixture.
11. `docs/GATE_7_MULTI_FILE_FEATURE.md` — multi-file feature qualification. The user goal does not name files.
12. `docs/GATE_8_N8N_FOUNDATION.md` — n8n capability hub. The hub cannot edit the workspace.
13. `docs/GATE_9_CAPABILITY_REGISTRY.md` — capability registry and name routing.
14. `docs/GATE_10_RESEARCH_ASSISTED_CODING.md` — research-assisted coding qualification.
15. `docs/GATE_11_AUTONOMOUS_HARDENING.md` — autonomous agent hardening.
16. `docs/CODEME_MODES.md` — Chat, Plan, Code, Debug and Multitask authority contracts.

## Current state

This repository intentionally starts clean. Do **not** copy the old CodeMe IDE wholesale into this repository.

Donor, pin, and what is allowed in this tree are recorded in `docs/SOURCE_TARGET.md`. Work continues on `migration/code-oss`. `main` stays free of migration experiments.

Current gate: **Gate 11 autonomous hardening is recorded** in `docs/GATE_11_AUTONOMOUS_HARDENING.md`. AgentRun locks the effective model, selects a versioned strategy, diagnoses failures, accepts mid-run follow-ups, and completes only with evidence. Run `sh scripts/qualify-hardening.sh`. The Code - OSS pin remains `1.139.1`. `research.web`, `code.lookup`, `code.debug`, `code.review`, `browser.inspect`, `image.generate`, and `deploy.verify` are reserved and not implemented. Progress follows the gates in `MASTER_BLUEPRINT.md`. Each phase must be verified before the next begins.

## Run CodeMe on Windows

CodeMe now has a first-class Windows source launcher. The Windows build uses the same Code - OSS pin, CodeMe extension, Pipeline v2, Composer, browser verification, n8n/Paperclip integrations, Project Brain, skills, and model providers as macOS.

On a fresh Windows PC, install the native build prerequisites first:

- Git for Windows
- Node.js **24.18.0** (the exact version required by the pinned Code - OSS source)
- Python 3
- Visual Studio 2022 Build Tools with **Desktop development with C++**
- Windows 10/11 SDK

Then, from PowerShell in the repository root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass

.\scripts\setup-codeme-windows.ps1
.\scripts\launch-codeme.ps1
```

After the one-time setup, normal launches can use:

```powershell
.\scripts\launch-codeme.ps1
```

or:

```cmd
scripts\launch-codeme.cmd
```

The launcher keeps CodeMe's isolated profile under `.tools\codeme-user-data`, loads the repository `.env`, and loads `extensions\codeme-shell` directly as the development extension. It does **not** require Windows symlink/developer mode.

If the repository was cloned without submodules, the setup script initializes the pinned `code-oss` submodule automatically.

## Local and remote AI models over Tailscale

The launcher automatically loads machine-specific endpoint settings from a repository-root `.env` file. Create it once with:

```bash
cp .env.example .env
```

The `.env.example` file is only a template; the running IDE does not receive those values until they are copied to `.env` (or exported in the shell).


CodeMe keeps the local Ollama instance on the Mac and can also discover models from the `codeme-ai` server over Tailscale. n8n stays local.

Current endpoints:

```bash
CODEME_N8N_URL=http://127.0.0.1:5678
CODEME_LOCAL_OLLAMA_URL=http://127.0.0.1:11434
CODEME_SERVER_OLLAMA_URL=http://100.81.117.90:11434
```

The Composer model selector discovers both endpoints. Models from the Mac are labelled `Local · ...`; models from `codeme-ai` are labelled `Server · ...`. The selected source is persisted with the model selection, so identical model names can exist on both machines without colliding.

The Mac and `codeme-ai` must both be connected to the same Tailscale tailnet. Ollama on the server must listen on an address reachable through Tailscale.

Quick checks from the Mac:

```bash
curl http://127.0.0.1:11434/api/tags
curl http://100.81.117.90:11434/api/tags
curl http://127.0.0.1:5678/healthz
```

Do not commit API keys, n8n tokens, or other secrets.

## In-IDE browser preview

CodeMe browser verification stays inside the IDE. When the agent uses `browser.check` or `browser.interact`, the preview runner opens the verified localhost URL in Code - OSS's built-in Simple Browser editor using `simpleBrowser.show`. It does not call the operating system's external browser.

This keeps the working loop in one place: Composer, files, terminal, diagnostics, and the live browser preview remain inside CodeMe.
