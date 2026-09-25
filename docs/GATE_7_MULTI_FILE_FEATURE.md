# Gate 7 — Multi-file feature qualification

Qwen 3.5 9B added user registration to a disposable service. The user goal did not name files. The writable tree was a copy of `packages/feature-qualify/fixture`, not the CodeMe source tree. n8n is not implemented.

## Fixture

`user-service` already had a health route, an app that owns one user repository, and a repository with `add` and `list`. `test/register.test.js` described registration and failed. The goal was:

> Add a user registration endpoint. Validate name and email, reject invalid input with appropriate errors, prevent duplicate email registration, store valid users through the existing repository layer, and add/repair the necessary tests.

Each of those requirements is stored on the AgentRun as `unverified`, `satisfied`, or `failed`. A passing model answer does not complete the run while any requirement is still open.

Command policy, workspace boundaries, iteration limits, cancellation, and timeouts are unchanged from Gate 6.

## Run

```sh
sh scripts/qualify-feature.sh
```

## Evidence

On this machine, 25 September 2026, that script exited 0 in about 379 seconds. Run `run_54772b3175c62dae`. The trace is `packages/feature-qualify/out/qualification.json`.

The model searched the repository, then read `src/app.js`, `src/users/repository.js`, `test/register.test.js`, and `src/routes/health.js`. `npm test` failed. It created `src/routes/register.js`, edited `src/app.js`, and the tests failed again. It then added `findByEmail` to the existing repository, reran `npm test`, and that run passed. Diagnostics reported no errors. The git diff was inspected after the last edit.

`filesChanged` matches the workspace changes:

- `src/app.js`
- `src/routes/register.js`
- `src/users/repository.js`

Registration is a `POST /users` handler. A blank name returns 400, an invalid email returns 400, a duplicate email returns 409, and a valid user is stored with `add` on the app's repository. The existing health check still passes. All seven requirements are `satisfied`. The run reached `completed` only after that verification. A file outside the fixture and this repository's git status were unchanged.

Gate 8 is recorded in `docs/GATE_8_N8N_FOUNDATION.md`.
