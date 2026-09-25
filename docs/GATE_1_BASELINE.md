# Gate 1 — Code - OSS baseline

Stock Code - OSS only. No CodeMe product code is part of this gate.

## Pin

| Field | Value |
|---|---|
| Upstream | https://github.com/microsoft/vscode.git |
| Release | `1.139.1` |
| Commit | `04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1` |
| Path | `code-oss/` (git submodule, shallow) |
| Node | `24.18.0` from `code-oss/.nvmrc` (npm must be below 13) |
| Local Node used for the build | `.tools/node-v24.18.0-darwin-arm64/` (not committed) |

Fetch the pin with `scripts/bootstrap-code-oss.sh`. A branch named `1.139.1` does not exist upstream, so `git submodule add -b 1.139.1` cannot be used. The submodule records the commit above.

## Build

From the repository root, with Node 24.18.0 on `PATH`:

```sh
cd code-oss
npm install
./scripts/code.sh
```

`./scripts/code.sh` runs the prelaunch compile and launches the Code - OSS desktop app.

## Verification

Not run yet. Gate 1 stays open until each item has executable evidence on this pin:

- desktop app builds and launches
- open a real folder
- create, read, edit, rename, delete, and save real files
- native terminal starts with the correct cwd, PATH, and environment
- stdin, stdout, stderr, exit status, and cancellation work
- a long-running dev server works
- Git/SCM works
- language diagnostics and navigation work
- close and reopen restores the workspace

Failures here are Code - OSS baseline failures. Do not debug them in CodeMe code.
