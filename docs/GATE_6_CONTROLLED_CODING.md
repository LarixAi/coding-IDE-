# Gate 6 — Controlled coding qualification

Qwen 3.5 9B completed a real repair through the AgentRun loop. The writable tree was a disposable copy of `packages/coding-qualify/fixture`, not the CodeMe source tree. n8n is not implemented. `ExternalCapabilityProvider` still returns `capability_unavailable`.

## Grant

`ControlledToolProvider` allows `file.read`, `file.write`, `repo.search`, `terminal.run`, `diagnostics.run`, `tests.run`, `git.status`, and `git.diff`.

`terminal.run` and `tests.run` accept only `npm test`, `node` on one workspace file, or `node --check` on one workspace file. The process is spawned without a shell. Pipes, redirects, absolute paths, and `..` are rejected. File paths are resolved against the fixture root, including a symlink that points outside it.

The read-only provider used by Gate 5 still rejects writes, terminal commands, and tests.

## Task

The fixture module `greet-fix` exports `greet`, which returned `"Hi"`. `test/greet.test.js` expects `greet("Ada")` to be `"Hello, Ada"`. The goal told the model to search, read the source and the test, run `npm test`, repair only `src/greet.js`, run diagnostics, rerun the test, and inspect the git diff. Completion is accepted only when that evidence is in the run. The runner does not write the fix.

## Run

```sh
sh scripts/qualify-coding.sh
```

## Evidence

On this machine, 25 September 2026, that script exited 0 in about 86 seconds. Run `run_3c2ebef33236d89f`. Model `qwen3.5:9b`. The trace is `packages/coding-qualify/out/qualification.json`.

Tool order recorded on the run:

1. `repo.search`
2. `file.read` `src/greet.js` and `test/greet.test.js`
3. `tests.run` `npm test` failed (`exit_status`)
4. `file.write` `src/greet.js` after that failure
5. `tests.run` `npm test` passed
6. `diagnostics.run` and `git.diff`

The next model request after the failing test contained that failure. `filesChanged` is `["src/greet.js"]`. The recorded diff is the final working-tree diff:

```diff
-  return "Hi";
+  return "Hello, " + name;
```

`greet("Ada")` returns `"Hello, Ada"`. The test file and `package.json` were unchanged. A sentinel file outside the fixture was unchanged. `git status` of this repository was the same before and after the run. Lifecycle moved through `awaiting_model`, `executing_tool`, `verifying`, and `completed`. The run stores 7 model decisions, the tool results, one repair, a failed verification, and a passing final verification.

Policy checks in the same script also passed: shell syntax and path escapes are rejected, the fixture test fails before editing, iteration limit and cancellation still stop a controlled run, and a git diff path is copied into `filesChanged`.

Gate 7 has not started. The model does not have write access to the CodeMe tree, and it does not have an open shell.
