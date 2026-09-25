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

Run on this machine against the pin above, with Node `v24.18.0` and npm `11.16.0`. Gate 1 stays open until every item has evidence.

| Check | Result |
|---|---|
| `npm install` in `code-oss/` | Passed. Exit 0. 1582 packages. |
| Electron download | Passed. `.build/electron/version` is `43.6.0`. |
| `node build/lib/preLaunch.ts` compile | Passed. Exit 0. Client compile finished with 0 errors. Built-in extensions downloaded. |
| Desktop app launches | Passed. `./scripts/code.sh` started `Code - OSS` with a renderer process and opened the `code-oss` folder. The process stayed up. |
| Create, read, edit, rename, delete, and save real files | Not run |
| Native terminal: cwd, PATH, environment | Not run |
| stdin, stdout, stderr, exit status, cancellation | Not run |
| Long-running dev server | Not run |
| Git/SCM | Not run |
| Language diagnostics and navigation | Not run |
| Close and reopen restores the workspace | Not run |

Failures here are Code - OSS baseline failures. Do not debug them in CodeMe code.
