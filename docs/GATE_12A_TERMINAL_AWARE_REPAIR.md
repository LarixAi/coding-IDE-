# Gate 12A — Terminal-aware repair

## Goal

Let Pipeline v2 consume real integrated-terminal evidence without unlocking or modifying the protected pipeline core.

This slice is an additive extension built beside Pipeline v2.

## Pipeline lock

Gate 12A must not modify any file listed in `.codeme/pipeline-lock.json`.

The implementation uses the existing `externalTools` extension point. The protected Pipeline v2 runtime continues to own model turns, tool execution, verification, completion, and repair limits.

## Added local tools

### `terminal.last`

Returns the most recent command observed through Code - OSS terminal shell integration:

- command line;
- confidence and trusted-command flag;
- workspace-relative working directory;
- status and exit code;
- bounded stdout/stderr terminal stream;
- timestamps.

### `terminal.failures`

Returns up to five recent failed observed terminal commands.

### `terminal.debug_bundle`

Returns the latest failed command as a compact handoff bundle suitable for outside research.

The bundle is bounded and redacted before it can be passed to n8n.

## Security boundary

Terminal observation is read-only.

CodeMe strips terminal control sequences and redacts common secret forms before returning data to the model, including:

- bearer credentials;
- GitHub, npm, AWS and OpenAI-style tokens;
- environment variables whose names indicate tokens, secrets, passwords, auth, cookies or API keys;
- common secret-bearing flags;
- common secret-bearing query parameters;
- URL user/password credentials;
- private-key blocks.

Raw terminal history is not sent to n8n automatically. The model should use `terminal.debug_bundle` and send only its `debugText` plus the minimum additional project evidence needed.

n8n remains untrusted evidence. It does not receive workspace mutation authority.

## External tool routing

`ExternalToolRouter` composes:

1. CodeMe local terminal-observation tools;
2. the existing n8n MCP tools.

A failed n8n discovery does not remove the local terminal tools.

## Runtime flow

Expected repair flow:

```
user runs command in integrated terminal
→ CodeMe observes command immediately
→ command ends non-zero
→ terminal.debug_bundle
→ optional n8n MCP research/debug workflow
→ CodeMe reads relevant local files
→ CodeMe repairs locally
→ CodeMe reruns/tests
→ process.start / browser.check / browser.interact when relevant
→ git.diff
→ verified completion
```

## Limitations of this slice

- Observation starts when the CodeMe extension activates; commands completed before activation cannot be recovered from old scrollback through the stable extension API.
- Terminal shell integration must be active for start/end events and reliable exit codes.
- Gate 12A observes terminals but does not yet grant general macOS application control. That belongs to a later Computer Bridge slice with separate permissions.

## Automated qualification

Run:

```sh
node extensions/codeme-shell/test/terminal-observer.test.js
node scripts/check-pipeline-lock.js
```

The terminal test proves:

- command/output capture;
- non-zero exit detection;
- workspace-relative cwd;
- ANSI/control stripping;
- secret redaction in command and output;
- bounded debug bundle generation;
- local terminal tools remain available when n8n discovery fails;
- routing works for both local and n8n tool providers;
- observer listeners are disposed safely.

The repository CI also runs this test through `scripts/test-ci.sh`.

## Manual IDE acceptance test

1. Launch CodeMe from this branch.
2. Open a disposable project.
3. In the integrated terminal, run a command that fails with a deterministic project error.
4. In Composer Code mode ask: `Fix the error currently showing in my terminal. Use n8n if outside knowledge is needed, then run and verify the app.`
5. Confirm the model uses terminal evidence without asking for a pasted error.
6. If outside research is needed, confirm only the redacted debug bundle is handed to n8n.
7. Confirm CodeMe edits locally, reruns the failing command, starts/reuses the application, verifies it with the browser tools where relevant, checks diagnostics/tests and records `git.diff`.
8. Confirm completion is withheld if verification fails.

## Exit criteria

Gate 12A is complete when automated CI passes and the real IDE acceptance test demonstrates the full terminal → diagnose → optional n8n → repair → rerun → verify sequence.
