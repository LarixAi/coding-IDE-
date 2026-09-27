# CodeMe Sandbox Execution

`sandbox.run` is a controlled CodeMe tool for disposable execution and verification.

## Purpose

The model can use the sandbox to reproduce an error, run a syntax/build/test check, or experiment before changing the real workspace.

The sandbox is **not** a file-editing mechanism. Any files created or changed inside it are discarded. Real project changes must still use `file.patch` or `file.write`.

## Hard rules

1. The command runs against a temporary copy of the active workspace.
2. Sandbox writes never modify the live workspace and never count as `filesChanged`.
3. `.git`, `node_modules`, `.tools`, and `.codeme` are not copied into the disposable workspace.
4. Environment secrets are not forwarded. The runner builds a small environment containing only runtime/path and temporary-directory settings.
5. Shell composition is rejected: no pipes, redirects, background `&`, command substitution, or chained commands.
6. Paths must be workspace-relative and cannot begin with a command-line flag.
7. Executable project code requires a strong OS isolation backend.
8. When a strong OS sandbox is unavailable, CodeMe may use the disposable copy for `node --check <file>` only; executable code/tests are refused with `sandbox_unavailable`.
9. Network access is denied by the strong macOS sandbox. A backend that cannot provide a strong boundary is reported honestly and is not used for executable project code.
10. Installed `node_modules` may be exposed read-only to a strong sandbox so existing project tests/builds can run without copying the dependency tree.
11. Output is bounded and execution has a timeout.
12. A sandbox result is verification evidence, not proof that a live-workspace edit happened.

## Supported commands

- `node <file>`
- `node --check <file>`
- `node --test [file]`
- `npm test`
- `npm run <script>`
- `python3 <file.py>`
- `python3 -m pytest [path]`

The contract can be expanded later, but new commands should be added deliberately rather than by allowing a general shell.

## Result metadata

CodeMe reports the command result together with:

- isolation backend
- whether a strong OS security boundary was active
- network policy
- disposable changed paths
- whether writes were discarded
- stdout / stderr / exit code

The Composer displays sandbox activity with an `SBOX` card.

## Tests

Run:

```sh
sh scripts/test-sandbox.sh
```

This covers the tool contract, orchestration/recovery regressions, and disposable-workspace runner.
