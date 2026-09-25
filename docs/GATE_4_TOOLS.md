# Gate 4 — Agent tool adapter

CodeMe owns the tool names and the result shape. Code - OSS performs the file, search, terminal, Git, diagnostics, and test work. The model does not import Code - OSS.

## Contract

`packages/agent-tools` accepts a tool name and arguments and returns:

```json
{ "ok": true, "tool": "file.read", "data": {} }
{ "ok": false, "tool": "file.read", "error": { "code": "path_escape", "message": "..." } }
```

A command that runs and exits non-zero is `ok: false` with `error.code` `exit_status` and the real `data.exitCode`, `stdout`, `stderr`, or terminal `output`.

| Tool | Required args | Code - OSS service |
|---|---|---|
| `file.read` | `path` | `vscode.workspace.fs` |
| `file.write` | `path`, `contents` | `vscode.workspace.fs` |
| `repo.search` | `query` | workspace file index, then a text match |
| `terminal.run` | `command` | integrated terminal shell integration |
| `git.status` | none | `vscode.git` repository status |
| `git.diff` | none | `vscode.git` working-tree diff |
| `diagnostics.run` | none | `vscode.languages` diagnostics |
| `tests.run` | `command` | a process in the open workspace |
| `browser.check` | `url` | interface only; returns `browser_unavailable` until a preview runner exists |

Paths must be workspace-relative. Absolute paths and `..` escapes fail before any service is called.

The host is `extensions/codeme-shell/code-oss-host.js`. It is the only place that imports `vscode`.

## Run

```sh
./scripts/test-codeme-tools.sh
```

That runs the contract checks in Node, then opens a temporary Git workspace in the pinned Code - OSS build and runs the same tools there.

## Evidence

On this machine, against Code - OSS `1.139.1`:

- Contract checks: 7 passing, including unknown tool, missing args, absolute path, path escape, and a non-zero exit.
- Code - OSS workspace checks: 8 passing. `file.write` / `file.read` round-trip, path escape, `repo.search` for `codeme-needle`, `git.diff` and `git.status` for that edit, `terminal.run` stdout and a non-zero `false`, `tests.run` stdout/stderr/exit 3, a syntax diagnostic on `broken.js`, and `browser.check` returning `browser_unavailable`.
- The script exited 0.

Gate 5 has not started. No model is connected.
