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

Run on this machine against the pin above, with Node `v24.18.0` and npm `11.16.0`. These are stock Code - OSS tests. No CodeMe code was added.

| Check | Result |
|---|---|
| `npm install` in `code-oss/` | Passed. Exit 0. 1582 packages. |
| Electron download | Passed. `.build/electron/version` is `43.6.0`. |
| `node build/lib/preLaunch.ts` compile | Passed. Exit 0. Client compile finished with 0 errors. |
| Desktop app launches | Passed. `./scripts/code.sh` started `Code - OSS` and opened the `code-oss` folder. |
| Create, read, edit, rename, delete, and save | Passed. API tests `fs.write/stat/read/delete`, `fs.delete folder`, and a workspace rename/read-back. Git smoke test edited and saved `app.js` and created `newfile.txt`. Smoke test typed into `app.js` and saved it. |
| Terminal cwd, PATH, and environment | Passed. Bash in the test workspace printed `pwd` for that folder, `printenv PATH` included `/usr/bin`, and `GATE1_MARKER=present` was visible. Split-terminal smoke test inherited cwd. |
| stdout, exit status, cancellation | Passed. `echo hello` returned stdout and exit 0. `fakecommand` returned a non-zero exit. A `python3 -m http.server` process was cancelled with Ctrl+C, then `curl` to that port failed. |
| Long-running server | Passed. The same HTTP server stayed up, `curl` received a directory listing, and the port closed after cancellation. |
| Git/SCM | Passed. `scripts/test-integration.sh --suite git`: 57 passing, 2 skipped. Includes working-tree status, the diff editor, stage, and commit. |
| Language diagnostics and navigation | Passed. Smoke tests: quick outline for JavaScript and CSS, and the Problems view for a CSS warning and an empty-rule error. |
| Close and reopen restores the workspace | Passed. Smoke tests `Data Loss (insiders -> insiders)`: restored editors, saved text restored after restart, hot exit, and autosave on shutdown. 10 smoke tests passing in 2 minutes. |

Commands, from `code-oss/` with Node 24.18.0 on `PATH` and `VSCODE_SKIP_PRELAUNCH=1`:

```sh
./scripts/test-integration.sh --suite git
./scripts/test-integration.sh --suite api-folder --grep 'fs.write/stat/read/delete|fs.delete folder|echo works|exit code \(zero\)|exit code \(non-zero\)|report zero exit code|report non-zero exit code|contents of command'
npm run smoketest-no-compile -- -g 'Data Loss \(insiders -> insiders\)|Language Features|should inherit cwd'
```

Gate 2 has not started.
