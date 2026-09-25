# Gate 3 — Minimal CodeMe shell

CodeMe product chrome on the unmodified Code - OSS pin. Explorer, editor, terminal, Git, and language services stay the native Code - OSS tools. There is no agent loop and no model connection yet.

## What was added

| Path | Role |
|---|---|
| `extensions/codeme-shell/` | CodeMe Dark theme, Composer view, and connection status |
| `scripts/launch-codeme.sh` | Starts the pinned build with that extension |

The theme colors are the donor dark tokens from `src/styles.css` at `ee3f2c27`, converted from oklch to hex. The Composer view is a new workbench webview. It does not copy `AgentPanel.tsx`.

Composer shows the idle sequence `Understanding → Planning → Editing → Testing → Fixing → Verifying → Complete` and the text "No agent is running. File edits stay off." The status item shows the recorded model grade.

## Launch

From the repository root, after the Gate 1 build:

```sh
./scripts/launch-codeme.sh
```

This uses Node `24.18.0` from `.tools/`, skips a second compile, and stores this profile in `.tools/codeme-user-data` so it does not share the plain Code - OSS profile.

## Evidence

Launched on this machine against Code - OSS `1.139.1` (`04c0d99f`).

- The extension host logged `Loading development extension at .../extensions/codeme-shell`.
- The extension host logged `CodeMe shell activated`.
- The new window title was `[Extension Development Host] Welcome — CodeMe`.
- The process was the pinned Electron binary with `--extensionDevelopmentPath` set to `extensions/codeme-shell`.

The macOS process name remains `Code - OSS` because `scripts/code.sh` resolves the built app from `product.json` `nameLong`. That file stays on the upstream pin. The workbench title, theme, Composer, and status item carry the CodeMe identity.

Later gates are recorded in `docs/GATE_4_TOOLS.md` and `docs/GATE_5_QUALIFICATION.md`.
