# Gate 2 — Donor migration inventory

Audit of `LarixAi/code-companion-pro` at `codeme/agent-loop-hardening`, commit `ee3f2c27c4476d611fdd0e19851df4827aa88557`. This file decides what may cross into this repository later. It does not copy donor source, and it does not delete anything in the donor.

## Classes

| Class | Meaning |
|---|---|
| KEEP | Portable product code. It can move with little or no change, and it does not depend on the old editor shell. |
| TRANSPLANT | CodeMe behavior worth keeping. Move it behind an adapter so it no longer calls the old web or Electron services. |
| REBUILD | Keep the visible contract (layout, states, tool names, outcomes). Implement it on Code - OSS. |
| REPLACE | Code - OSS already provides this. Do not port the implementation. |
| DELETE | Do not carry it into the new IDE. It stays in the donor until a replacement is proven. |

## Tool contract to preserve

`src/lib/agent/tools.ts` is the agent-facing contract. Gate 4 implements it on Code - OSS services. The names stay stable even where the body is rebuilt:

`repo.search`, `file.read`, `file.write`, `file.str_replace`, `file.delete`, `file.multi_write`, `file.move`, `file.list`, `terminal.run`, `process.read`, `git.status`, `git.diff`, `git.show`, `git.worktree_list`, `git.worktree_add`, `git.worktree_remove`, `tests.run`, `diagnostics.run`, `lsp.hover`, `lsp.definition`, `lsp.diagnostics`, `lsp.references`, `lsp.rename`, `browser.inspect`, `browser.capture`, `docs.lookup`, `deps.inspect`, `project.memory`, `design.plan`, `site.scaffold`, `site.add_page`, `site.design_check`, `site.sync_nav`, `site.fix_layout`, `web.search`, `web.fetch`, `vision.analyze`, `agent.complete`.

## CodeMe UI reference

These files are the visual and behavioral reference. Gate 3 uses only the shell pieces. Gate 7 takes the rest, surface by surface.

| Path | Class | Reason |
|---|---|---|
| `src/components/codeme/WorkspaceShell.tsx` | REBUILD | CodeMe layout contract. The workbench shell is Code - OSS. |
| `src/components/codeme/ActivityBar.tsx` | REBUILD | Activity navigation stays CodeMe-shaped on the Code - OSS activity bar. |
| `src/components/codeme/SidePanel.tsx` | REBUILD | Panel chrome around explorer, search, and source control. |
| `src/components/codeme/AgentPanel.tsx` | TRANSPLANT | Composer and agent experience. Decouple it from the old IDE services in stages. |
| `src/components/codeme/ModelSelector.tsx` | TRANSPLANT | Model selection is product behavior. |
| `src/components/codeme/ConnectServerDialog.tsx` | TRANSPLANT | AI server connection UX. |
| `src/components/codeme/RunInspector.tsx` | TRANSPLANT | Run and tool inspection. |
| `src/components/codeme/PreviewPanel.tsx` | REBUILD | Preview contract. Host it on a Code - OSS view, not the old Electron preview process. |
| `src/components/codeme/WelcomeScreen.tsx` | REBUILD | Onboarding contract. Opening a folder is a Code - OSS workspace action. |
| `src/components/codeme/SettingsDialog.tsx` | REBUILD | Settings contract, rendered through Code - OSS settings where the setting is an IDE setting. |
| `src/components/codeme/DaemonSettings.tsx` | DELETE | Settings for the old daemon. Code - OSS owns process lifetime. |
| `src/components/codeme/BottomPanel.tsx` | REBUILD | Bottom panel contract over Code - OSS panel, terminal, and problems. |
| `src/components/codeme/StatusBar.tsx` | REBUILD | Status contract over Code - OSS status items. |
| `src/components/codeme/CommandPalette.tsx` | REPLACE | Code - OSS owns the command palette. Keep CodeMe command names where they are product commands. |
| `src/components/codeme/ExplorerPanel.tsx` | REPLACE | Code - OSS owns the file explorer. |
| `src/components/codeme/SearchPanel.tsx` | REPLACE | Code - OSS owns search. |
| `src/components/codeme/ScmPanel.tsx` | REPLACE | Code - OSS owns Git and SCM. |
| `src/components/codeme/EditorArea.tsx` | REPLACE | Code - OSS owns the editor. |
| `src/components/codeme/monaco-theme.ts` | REBUILD | Theme decisions are product identity. Apply them as a Code - OSS theme, not a Monaco shell. |
| `src/components/codeme/XtermPane.tsx` | REPLACE | Code - OSS owns the terminal. |
| `src/components/codeme/DebugPanel.tsx` | REPLACE | Code - OSS owns the debugger. |
| `src/components/codeme/primitives.tsx` | TRANSPLANT | Reusable CodeMe widgets used by Composer and settings. |
| `src/styles.css` | REBUILD | Design-token reference. Extract CodeMe colors, type, and spacing. Do not drop this stylesheet onto the workbench. |
| `src/components/ui/` (46 shadcn files) | DELETE | Web-shell widget kit. CodeMe surfaces that survive are rebuilt on workbench UI. |
| `src/hooks/use-mobile.tsx` | DELETE | Web-shell responsive hook. |

## Agent, session, and strategy

| Path | Class | Reason |
|---|---|---|
| `src/store/agent.ts` | TRANSPLANT | Agent run state. |
| `src/store/agent-session.ts` | TRANSPLANT | Session state. |
| `src/store/provider.ts` | TRANSPLANT | Provider and model selection state. |
| `src/store/host.ts` | TRANSPLANT | Server connection state. |
| `src/store/ui.ts` | REBUILD | CodeMe panel visibility only. Workbench layout state stays in Code - OSS. |
| `src/store/recents.ts` | REPLACE | Code - OSS stores recent workspaces. |
| `src/store/selectors.ts` | TRANSPLANT | Keep selectors for agent, session, and provider. Drop selectors for editor, terminal, SCM, and workspace. |
| `src/store/editor.ts` | REPLACE | Code - OSS owns editor state. |
| `src/store/terminal.ts` | REPLACE | Code - OSS owns terminal state. |
| `src/store/scm.ts` | REPLACE | Code - OSS owns SCM state. |
| `src/store/workspace.ts` | REPLACE | Code - OSS owns workspace state. |
| `src/store/daemon.ts` | DELETE | Old daemon client state. |
| `src/lib/agent/tools.ts` | TRANSPLANT | Tool names, schemas, and result types. Adapters underneath are rebuilt. |
| `src/lib/agent/strategy/` (`catalog.ts`, `classify.ts`, `model-profile.ts`, `outcome.ts`, `select.ts`, `types.ts`) | TRANSPLANT | Strategy selection is CodeMe-owned and already specified in `docs/CODEME_STRATEGY_ENGINE.md`. |
| `src/lib/agent/constitution.ts`, `guardrails.ts`, `preflight.ts`, `project-memory.ts`, `project-rules.ts`, `design-plan.ts` | TRANSPLANT | Product policy, requirements, and project memory. |
| `src/lib/agent/driver.ts`, `agent-runtime.ts`, `agent-shell.ts`, `agent-shell-types.ts`, `agent-workspace.ts` | TRANSPLANT | The run loop. Retarget execution at the Code - OSS tool adapter. |
| `src/lib/agent/retrieval-pipeline.ts`, `repo-index.ts`, `repo-index-worker.ts`, `search-rg.ts`, `smart-listing.ts` | REBUILD | Repository search contract. The search primitive is Code - OSS search plus the agent tool result shape. |
| `src/lib/agent/diagnostics-collect.ts`, `test-output.ts` | REBUILD | Diagnostics and test evidence, read from Code - OSS problems and tasks. |
| `src/lib/agent/git-real.ts` | REPLACE | Git operations go through Code - OSS SCM. Keep the `git.*` tool result shapes from `tools.ts`. |
| `src/lib/agent/workspace-exec.ts`, `exec-router.ts`, `exec-allowlist.ts`, `container-exec.ts` | REBUILD | Keep the allowlist policy. Execute through the Code - OSS terminal, not the old process bridge or container daemon. |
| `src/lib/agent/site-tools.ts`, `run-site-tools.ts`, `browser-capture-eval.ts`, `docs-lookup.ts`, `tool-examples.ts`, `adapters.ts` | TRANSPLANT | Product tools (site, browser, docs). Wire them to the new tool runtime in Gate 4, not to the old preview daemon. |
| `src/lib/codeme/tool-presentation.ts` | TRANSPLANT | How tool calls are shown in Composer. |
| `src/lib/codeme/diff.ts` | TRANSPLANT | Changed-file and diff presentation. The diff view itself is Code - OSS. |
| `src/lib/codeme/session-recovery.ts` | TRANSPLANT | Recovery contract for Gate 9. Reconcile against Git and the filesystem before any replay. |
| `src/lib/codeme/persistence.ts`, `operation.ts`, `types.ts`, `attachments.ts` | TRANSPLANT | Session records, run operations, and composer attachments. |
| `src/lib/codeme/workspace-prefs.ts` | REBUILD | Product preferences that are not already Code - OSS settings. |
| `src/lib/codeme/fuzzy.ts`, `symbols.ts` | REPLACE | Quick open and symbols are Code - OSS. |
| `src/lib/codeme/preview-url.ts`, `preview-capture-client.ts` | REBUILD | Preview URL and capture contract for frontend verification. |
| `src/lib/codeme/sample-project.ts` | DELETE | Built-in sample project. Gate 1 already opens real folders. |

## Providers, protocol, and harness

These packages are already separate from the IDE shell. They stay independent of Code - OSS.

| Path | Class | Reason |
|---|---|---|
| `packages/protocol/` | KEEP | Run, tool-call, approval, and worker protocol. |
| `packages/event-schema/` | KEEP | Event codec and reducer for runs. |
| `packages/harness-core/` | KEEP | Instruction stack, tool selection, completion gates. |
| `packages/harness-qwen/` | KEEP | Qwen profile, repair, and native tool harness. |
| `packages/model-providers/` | KEEP | Provider interface and Ollama, OpenAI, Anthropic, and Gemini adapters. |
| `src/lib/ai/model-router.ts`, `provider-boot.ts`, `parse-model-json.ts`, `vision.ts`, `inline.ts`, `agent-turn.ts` | TRANSPLANT | IDE-facing model roles and turn handling. Detach them from the web store imports. |
| `src/lib/ai/provider-client.ts`, `host-client.ts`, `control-plane-client.ts` | REBUILD | They call the old web gateway (`/api/auth/token`, `/api/ollama`). Talk to the control plane through `packages/protocol` instead. |
| `src/lib/ai/ollama.ts`, `ollama-client.ts`, `ollama-http.ts`, `ollama-turn.ts`, `ollama-context.ts`, `ollama-endpoint.ts`, `ollama.server.ts`, `openai-client.ts`, `anthropic-client.ts`, `cloudflare-client.ts`, `provider-secrets.ts` | DELETE | Duplicate provider clients. `packages/model-providers` is the copy that survives. |

## Infrastructure Code - OSS replaces

| Path | Class | Reason |
|---|---|---|
| `desktop/electron/main.cjs`, `preload.cjs`, `menu.cjs`, `process-manager.cjs`, `package.json` | REPLACE | Desktop lifecycle, windows, menus, and processes. |
| `desktop/electron/lsp-server.mjs`, `language-service.cjs` | REPLACE | Language services. |
| `desktop/electron/preview-manager.cjs`, `preview-browser.cjs` | DELETE | Old preview processes. The preview contract is rebuilt from `PreviewPanel.tsx`. |
| `desktop/electron/provider-cloud.cjs` | DELETE | Electron-only provider bridge. Providers live in `packages/model-providers`. |
| `src/lib/desktop/` | REPLACE | Desktop detection, preload API, and menu bridge. |
| `src/lib/workspace/` | REPLACE | Filesystem and workspace backends. `identity.ts` project identity is revisited at Gate 9 recovery, using Code - OSS workspace identity. |
| `src/lib/lsp/` | REPLACE | Monaco language client and the VS Code shim. |
| `src/lib/daemon/client.ts` | DELETE | Client of the old daemon. |
| `agent/codeme-daemon.mjs`, `sandbox-run.mjs`, `exec-allowlist.mjs`, `tsc-diagnostics.mjs` | DELETE | Standalone process bridge. The allowlist policy itself is kept from `src/lib/agent/exec-allowlist.ts`. |
| `agent/preview-browser-client.mjs`, `preview-browser-daemon.mjs`, `preview-browser-lib.mjs`, `preview-capture.mjs`, `preview-capture-runner.mjs` | DELETE | Old preview stack. |
| `src/routes/`, `src/router.tsx`, `src/routeTree.gen.ts`, `src/server.ts`, `src/start.ts` | DELETE | TanStack Start web shell. |
| `src/lib/server/preview-gateway.ts`, `codeme-auth.ts`, `provider-secrets-file.ts` | DELETE | Web-server routes in the IDE app. Auth and secrets for the AI server stay with the control plane. |
| `vite.config.ts`, `vite-codeme-gateway.mjs`, `electron-builder.yml`, `components.json`, `public/favicon.ico`, `public/robots.txt` | DELETE | Web and Electron packaging for the old app. |
| `src/lib/lovable-error-reporting.ts`, `error-page.ts`, `error-capture.ts`, `src/lib/utils.ts` | DELETE | Lovable and web-shell helpers. |

## AI server, which stays outside the IDE

Code - OSS does not replace the inference server. These stay in the donor until a gate explicitly names them. They are not copied in Gate 3.

| Path | Class | Reason |
|---|---|---|
| `apps/control-plane/` | KEEP | Server-owned model inference and run control. Separate service. |
| `deploy/codeme-control-plane.service` | KEEP | Service unit for that server. |
| `infrastructure/remote-access/` | KEEP | Operator scripts for the existing tunnel. Not IDE product code. |
| `docs/adr/0001-server-control-plane-is-public-origin.md`, `0002-ollama-loopback-only.md`, `0005-server-owned-model-inference.md` | KEEP | Constraints on the server. Already reflected by leaving the control plane out of the IDE tree. |
| `docs/server/`, `docs/REMOTE_ACCESS.md`, `docs/API_SETUP.md`, `docs/N8N_QWEN_IDE_WORKFLOW_GUIDE.md`, `CONNECT_AI_SERVER.md`, `AI_SERVER_CURRENT.md` | KEEP | Server and operator docs. Copy only when a later gate names the file. |
| `scripts/start-ai-server.sh`, `remote-start-ai-server.sh`, `control-plane-smoke.mjs`, `laptop-host-core.mjs` | KEEP | Server operation. |

## Tests

Port a test only after the code it guards has a class of KEEP or TRANSPLANT and the new adapter exists.

| Paths | Class | Reason |
|---|---|---|
| `packages/harness-core/test/`, `packages/harness-qwen/test/`, `packages/model-providers/test/`, `packages/event-schema/src/codec.test.ts`, `packages/model-providers/src/capabilities.test.ts` | KEEP | Tests for the packages that move as-is. |
| `tests/e2e/agent-tool-contract.e2e.ts`, `agent-tool-registry.e2e.ts`, `agent-runtime.e2e.ts`, `agent-workspace.e2e.ts`, `agent-search-native.e2e.ts`, `ask-plan-context.e2e.ts`, `design-plan-gate.e2e.ts`, `exec-router.e2e.ts`, `model-router.e2e.ts`, `ollama-context.e2e.ts`, `prompt-contamination.e2e.ts`, `provider-boot.e2e.ts`, `provider-settings.e2e.ts`, `git-argv-safety.e2e.ts`, `real-workspace-only.e2e.ts` | TRANSPLANT | Qualification for the agent contract. Retarget them at the Code - OSS adapter. |
| `tests/agent-eval/` | TRANSPLANT | Live qualification scenarios for later gates. |
| `tests/e2e/welcome-operations.e2e.ts`, `no-template-scaffold.e2e.ts`, `scaffold-intent.e2e.ts`, `worktree-agent.e2e.ts`, `site-design-check-batch.e2e.ts` | REBUILD | Product outcomes. Rewrite against the new shell. |
| `tests/e2e/electron-acceptance.mjs`, `desktop-agent-coding-live.mjs`, `lsp-server.e2e.mjs`, `workspace-explorer.e2e.mjs`, `workspace-root.e2e.ts`, `workspace-store.e2e.ts`, `create-project-real-disk.e2e.ts`, `clone-repository-real-disk.e2e.ts`, `git-not-repo.e2e.ts` | REPLACE | They assert the old desktop, explorer, LSP, and disk bridge. Gate 1 already covers the Code - OSS versions of those workflows. |
| `tests/e2e/gateway.e2e.mjs`, `web-api.e2e.ts`, `remote-access.e2e.mjs`, `container-sandbox.e2e.mjs` | KEEP | Belong to the server, gateway, or old sandbox. Leave them with that service. |
| `tests/e2e/tmp-heal-probe.mjs`, `tmp-model-probe.mjs`, `tmp-schema-probe.mjs`, `tmp-select-probe.mjs`, `tmp-tool-probe.mjs`, `test_codeme.py` | DELETE | Scratch probes and the old web harness. |
| `.github/workflows/test.yml`, `live-eval.yml` | REBUILD | CI for this repository comes after the new build exists. Do not copy the old workflows as-is. |
| `scripts/build-macos-app.sh`, `desktop-launcher.mjs`, `run-electron.mjs`, `run-gateway-e2e.mjs`, `agent-code-in-workspace.mjs` | DELETE | Launchers for the old Electron app and web gateway. |

## Already in this repository

`MASTER_BLUEPRINT.md`, `docs/CODEME_CODE_OSS_MIGRATION.md`, `docs/AGENT_LOOP_HARDENING_SEQUENCE.md`, and `docs/CODEME_STRATEGY_ENGINE.md` match the donor pin. `docs/DESKTOP.md` and `docs/TESTING.md` stay in the donor; they describe the old shell.

## Left behind on purpose

`.lovable/` is planning scratch. `roadmap.md` and `AGENTS.md` in the donor describe the old repository. They are DELETE for this IDE tree.

## What this inventory allows next

Gate 3 may use the CodeMe visual reference (`WorkspaceShell`, activity and status chrome, `monaco-theme.ts`, `styles.css`) to brand the Code - OSS shell. It may add a minimal Composer panel only as a shell. It may not copy REPLACE or DELETE paths, and it may not start the agent loop, provider packages, or control plane.
