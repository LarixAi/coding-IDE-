# CodeMe repository rules

## Canonical pipeline lock

The current Pipeline v2 is a locked, approved baseline.

Do not modify any file listed in `.codeme/pipeline-lock.json` unless the repository owner has explicitly approved a pipeline change in the current task or conversation.

Do not update the hashes in `.codeme/pipeline-lock.json` merely to make CI pass.

If a requested feature appears to require changing a locked pipeline file:
1. Stop before modifying it.
2. Explain which protected file would need to change and why.
3. Ask the owner for explicit permission to unlock/change the pipeline.
4. Only after approval, make the smallest pipeline change, run the full qualification suite, and update the lock baseline deliberately.

New features should be additive wherever possible. Prefer:
- external MCP/tool providers,
- capability providers,
- new tool implementations behind existing contracts,
- UI/view modules,
- optional services and adapters,
- new packages that call into the existing pipeline through its public interfaces.

The purpose of this rule is to let CodeMe gain features without silently changing the working orchestration, routing, context, verification, repair, or follow-up behavior that has already been qualified.

## Composer mode authority

CodeMe modes are permission contracts, not prompt suggestions. Follow `docs/CODEME_MODES.md`.

- Chat and Plan are read-only.
- Code is the normal controlled mutation mode.
- Debug must reproduce a concrete failure before mutation and must rerun the original failing check after repair.
- Multitask is Paperclip orchestration; only the Developer role may perform normal source mutation.
- Product Manager, Software Architect, Research, Test and Reviewer roles must not silently widen their authority.
- Multitask must fail closed when the required Paperclip team is unavailable; never silently downgrade it to Code.

