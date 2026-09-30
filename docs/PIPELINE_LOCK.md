# CodeMe Pipeline v2 Lock

## Status

Pipeline v2 is the canonical, qualified CodeMe pipeline.

Frozen baseline branch:

`pipeline-v2-locked-baseline`

Baseline commit:

`15031552820524819bbdf97b9b4b150a9f642669`

The exact protected file hashes are stored in:

`.codeme/pipeline-lock.json`

CI runs `scripts/check-pipeline-lock.js`. If any protected file no longer matches the approved baseline, CI fails.

## What this protects

The lock covers the core orchestration and the qualification tests that define its behavior, including:

- run creation and lifecycle,
- task/intent routing,
- model context construction,
- model/tool loop behavior,
- verification and repair behavior,
- follow-ups/requirements,
- model-provider behavior,
- tool/capability contracts,
- the Composer entry into Pipeline v2,
- canonical Pipeline v2 regression tests.

## What can still be added without unlocking the pipeline

Add-ons should be built beside the core rather than through it. Examples:

- n8n MCP workflows and external-tool providers,
- new capability providers,
- additional integrations,
- new model/provider adapters that preserve the current core contract,
- UI controls and views,
- tool implementations behind existing interfaces,
- optional services,
- logging, telemetry, history, and developer tooling.

An add-on should consume the pipeline's public interfaces and should not change the protected files.

## Approved pipeline-change procedure

A protected pipeline file must not be changed merely because an add-on is easier to implement that way.

When a genuine core change is required:

1. Explain the exact protected files and behavior that need to change.
2. Obtain explicit approval from the repository owner.
3. Make the smallest possible change on a dedicated PR.
4. Run the full CI/qualification suite.
5. Review the behavioral diff.
6. Deliberately update `.codeme/pipeline-lock.json` to the newly approved Git blob hashes.
7. Move/create a new frozen baseline only after the new pipeline has been accepted.

Never refresh lock hashes automatically.
