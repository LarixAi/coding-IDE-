# CodeMe Adaptive Strategy Engine

Status: architecture target for `codeme/agent-loop-hardening`

## Purpose

CodeMe should improve coding reliability without requiring the underlying model weights to be retrained after every task. The model supplies intelligence; CodeMe supplies engineering discipline, tools, verification, memory, and accumulated experience.

The strategy engine chooses a tested execution playbook for the current task, project and model, measures the result, and uses validated outcomes to improve future strategy selection.

## Core loop

```text
User prompt
  -> classify task
  -> inspect project context
  -> read model capability profile
  -> select strategy
  -> execute through CodeMe tools
  -> verify with objective evidence
  -> repair/retry when required
  -> record outcome
  -> evaluate strategy performance
  -> retain, adjust, or roll back strategy
```

A model must never be allowed to declare success by itself. Existing CodeMe completion gates remain authoritative.

## Strategy types

Initial strategy families:

- `bug-fix`: reproduce -> isolate -> patch -> regression test -> verify
- `feature`: inspect -> design -> implement incrementally -> integration test -> verify
- `frontend-ui`: inspect -> design plan -> implement -> run -> desktop/tablet/mobile capture -> visual QA -> repair -> verify
- `refactor`: establish baseline -> small transformations -> diagnostics/tests after stages -> regression verify
- `database`: inspect schema -> plan migration -> migrate -> update application -> migration/integration tests -> verify
- `api-integration`: inspect contract/docs -> implement -> exercise success/error paths -> verify
- `performance`: establish measurement -> locate bottleneck -> change -> benchmark -> compare -> verify
- `security`: identify relevant threat surface -> implement least-privilege change -> security/regression checks -> verify
- `general`: inspect -> plan -> implement -> diagnostics/tests -> repair -> verify

Strategies should describe required stages and evidence, not contain provider-specific business logic.

## Model profiles

CodeMe should maintain a profile for each model/provider combination. Example fields:

```ts
interface ModelCapabilityProfile {
  provider: string;
  model: string;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  contextWindow?: number;
  preferredStepSize?: "small" | "medium" | "large";
  preferredStrategyOverrides?: Record<string, string>;
  qualification: "unknown" | "chat-only" | "limited-agent" | "agent-ready" | "verified";
}
```

An unknown model should be capability-probed before full Agent mode. Discovery alone does not imply compatibility.

Suggested qualification flow:

```text
discover model
 -> connectivity check
 -> structured-output check
 -> tool-call check
 -> repository-context check
 -> controlled edit task
 -> verification/recovery task
 -> assign capability level
```

Failure should degrade gracefully to limited Agent or Chat mode instead of breaking the IDE.

## Experience records

Every agent run should emit a compact structured outcome record. Do not store secrets, raw credentials, or unnecessary source code in the experience store.

Suggested shape:

```ts
interface StrategyRunOutcome {
  strategyId: string;
  strategyVersion: number;
  taskClass: string;
  provider: string;
  model: string;
  projectKind?: string;
  success: boolean;
  firstPassSuccess: boolean;
  verificationPassed: boolean;
  repairLoops: number;
  toolFailures: number;
  humanInterventions: number;
  durationMs: number;
  failureCategory?: string;
  usefulLessonIds?: string[];
}
```

## Three levels of learning

### 1. Project memory

Repository-specific knowledge such as architecture, commands, conventions, known pitfalls, previous failures and successful fixes. This knowledge should remain scoped to the project.

### 2. Model experience

Empirical information about how a particular model performs: reliable task classes, tool-calling behaviour, preferred task size, retry behaviour, context limits, common failure modes and strategy overrides.

### 3. CodeMe global strategy knowledge

Only lessons demonstrated across sufficient validated runs should become global strategy rules. A single successful run must never silently create a permanent global rule.

## Promotion and rollback

Strategies must be versioned. New strategies or strategy changes begin as candidates.

A candidate is promoted only when benchmark evidence shows it improves the relevant reliability metrics without unacceptable regressions. If later measurements regress, CodeMe must be able to restore the previous strategy version.

Initial metrics:

- final verified success rate
- first-pass success rate
- repair-loop count
- tool failure rate
- human intervention rate
- time to verified completion
- regression rate
- optional provider/token cost when available

Do not optimize solely for speed or token cost. Verified correctness is the primary objective.

## Selection

The strategy selector should initially be deterministic and explainable rather than another unconstrained LLM decision.

Inputs:

- task classification
- project kind
- changed surface (frontend/backend/database/etc.)
- selected model capability profile
- available tools
- previous validated strategy performance

Output:

- strategy ID/version
- required stages
- required verification evidence
- model-specific execution hints

The selector can become more adaptive after reliable benchmark data exists.

## Integration with the current agent loop

Do not replace CodeMe's existing runtime and completion gates. Integrate around them.

Recommended modules:

```text
src/lib/agent/strategy/
  types.ts
  catalog.ts
  classify.ts
  select.ts
  model-profile.ts
  outcome.ts
  lessons.ts
```

Recommended execution path:

```text
agent-session
 -> classifyTask()
 -> selectStrategy()
 -> add strategy guidance to agent context
 -> existing runAgentTurn/tool loop
 -> existing diagnostics/tests/browser/completion gates
 -> recordStrategyOutcome()
```

Existing tool contracts remain CodeMe-owned. Strategies tell the agent which engineering procedure/evidence is required; they do not bypass tool validation or completion gates.

## Reliability guardrails

- Never learn directly from the model saying a task succeeded.
- Only verification evidence can mark an outcome successful.
- Never promote a lesson globally from one run.
- Scope project-specific lessons to that repository.
- Keep strategy versions and support rollback.
- Separate model/provider quirks from universal engineering rules.
- Sanitize experience records so source secrets and credentials are not accumulated.
- Bound retries and repair loops.
- Preserve human approval for destructive/high-impact actions where CodeMe policy requires it.

## UX requirement

The strategy engine must not make CodeMe more overwhelming.

Default UI should expose only useful activity states such as:

```text
Understanding
Planning
Editing
Testing
Fixing
Verifying
Complete
```

Advanced users may expand details to see the selected strategy, model profile, tool calls, diagnostics, retries, diffs and verification evidence.

The normal user should not need to understand strategy IDs, tokens, context windows, tool schemas or model adapters.

## Benchmark / qualification suite

Create a repeatable task suite and run the same jobs across supported models and strategy versions. Include at minimum:

1. small bug fix
2. multi-file feature
3. frontend UI change with visual verification
4. refactor with regression protection
5. API integration
6. database/schema change
7. deliberately failing test requiring diagnosis and repair
8. tool failure/recovery scenario
9. long-running multi-stage task
10. unknown-model capability qualification

Store results in a machine-readable format so strategy/model comparisons can be made without relying on subjective impressions.

## Implementation phases

### Phase 1 - deterministic strategies

- add strategy types/catalog
- classify common task families
- select a deterministic strategy
- inject strategy guidance into the current agent context
- record outcome metrics
- add tests

### Phase 2 - model qualification

- capability probe unknown models
- persist model profiles
- Agent Ready / Limited Agent / Chat Only states
- model-specific strategy hints

### Phase 3 - experience and evaluation

- project-scoped lessons
- model performance history
- benchmark runner
- candidate strategy comparison
- explicit promotion/rollback

### Phase 4 - product UX

- simple activity states by default
- expandable advanced trace
- model compatibility/status UI
- reliability/verification evidence in final outcome

## Immediate branch priority

The strategy engine should be introduced only after/alongside the current hardening fundamentals: connectivity preflight, bounded turn recovery, stable tool execution, verification-state consistency and completion gates. A learning system built on an unreliable execution loop would learn from noisy outcomes.
