# Gate 3 — Minimal CodeMe shell

CodeMe product chrome on the unmodified Code - OSS pin. Explorer, editor, terminal, Git, and language services stay the native Code - OSS tools. There is no agent loop and no model connection yet.

## What was added

| Path | Role |
|---|---|
| `extensions/codeme-shell/` | CodeMe Dark theme, Composer view, and connection status |
| `scripts/launch-codeme.sh` | Starts the pinned macOS build with that extension |
| `scripts/launch-codeme.ps1` | Starts the pinned Windows build with the CodeMe development extension |
| `scripts/launch-codeme.cmd` | CMD wrapper for the Windows PowerShell launcher |
| `scripts/setup-codeme-windows.ps1` | One-time Windows submodule/dependency/build preparation |

The theme colors are the donor dark tokens from `src/styles.css` at `ee3f2c27`, converted from oklch to hex. The Composer view is a new workbench webview. It does not copy `AgentPanel.tsx`.

Composer shows the idle sequence `Understanding → Planning → Editing → Testing → Fixing → Verifying → Complete` and the text "No agent is running. File edits stay off." The status item shows the recorded model grade.

## Launch

From the repository root, after the Gate 1 build:

macOS:

```sh
./scripts/launch-codeme.sh
```

Windows PowerShell:

```powershell
.\scripts\launch-codeme.ps1
```

Windows CMD:

```cmd
scripts\launch-codeme.cmd
```

For a fresh Windows checkout, run the one-time preparation first:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-codeme-windows.ps1
```

Both platforms use the exact Code - OSS Node pin `24.18.0` and store the CodeMe profile in `.tools/codeme-user-data` so it does not share the plain Code - OSS profile. The Windows launcher uses `--extensionDevelopmentPath` rather than filesystem symlinks, so Windows Developer Mode is not required just to load the CodeMe shell.

## Evidence

Launched on this machine against Code - OSS `1.139.1` (`04c0d99f`).

- The extension host logged `Loading development extension at .../extensions/codeme-shell`.
- The extension host logged `CodeMe shell activated`.
- The new window title was `[Extension Development Host] Welcome — CodeMe`.
- The process was the pinned Electron binary with `--extensionDevelopmentPath` set to `extensions/codeme-shell`.

The macOS process name remains `Code - OSS` because `scripts/code.sh` resolves the built app from `product.json` `nameLong`. That file stays on the upstream pin. The workbench title, theme, Composer, and status item carry the CodeMe identity.

Later gates are recorded in `docs/GATE_4_TOOLS.md` and `docs/GATE_5_QUALIFICATION.md`.
