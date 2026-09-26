# Gate 10 — research-assisted coding qualification

CodeMe stays the runtime authority. Qwen reasons and chooses coding actions. Code-OSS hosts the tools. n8n returns evidence and nothing else.

## The runtime defect this gate had to fix first

The first attempt at this gate stalled. Qwen spent minutes restating the same repair without editing a file. Stagnation was recorded as telemetry and the only response was another message asking the model to call a capability. The model is not responsible for noticing that it is stuck, so the runtime now owns progress detection, loop limits, strategy transitions, capability eligibility, and cancellation.

Four defects were found and fixed with real traces from failed runs.

**A tool call is not progress.** Semantic categories are a new relevant file, a new implementation fact, a new failing diagnostic or test, a new hypothesis, a code modification, a changed test result, a successful verification, and external evidence obtained. Repeated searches and rereads that leave the working hypothesis unchanged are stagnation. `repeatedIntentCount` is a control signal: with no material category it increments semantic stagnation. The threshold is two consecutive turns.

**Reworded reasoning is not a new hypothesis.** Run `run_00ed76ab738c7883` produced four consecutive tool-free turns with `semanticStagnation` still at 0, because each rewording was credited as `new_hypothesis`. A hypothesis now counts only when the turn also takes an action, or on the first tool-free turn, and two consecutive tool-free turns count as repeated intent.

**Compaction must not blind the model.** Run `run_c2a1b4a5f6ba264c` replaced 12 of 27 tool messages with summaries such as `Already read test/check.test.js. The contents are unchanged.` The model then spent 28 of 40 turns attempting `ls -la`, `node -e`, and `node --eval` to recover a file the runtime had taken away. The newest observation now always carries the full payload and identical earlier copies collapse instead, so duplicate evidence costs context once. Full results stay on `toolCalls` and `observations` either way.

**A refused call is not evidence.** `command_rejected` and `not_found` used to count as a new failure and reset the counter. Only a real program result counts now.

**One research request per unresolved problem.** The question key is derived from the goal. A drifting hypothesis is a symptom of being stuck, so it must not make the same question look new. `run_c2a1b4a5f6ba264c` escalated twice for one problem before this change.

## State transitions

```
working → stagnant → research_needed → researching → working
```

`researching` is a runtime-issued request, recorded with `directedBy: "runtime"`, and the result stays `trusted: false`. The capability is selected from the registry by contract, not by name: category `research`, risk `read`, permissions limited to `evidence` or `network`. When no such capability is registered, or the same question was already researched, the run ends `failed` with code `stagnation`.

After research the runtime injects a compact observation holding the unresolved problem, the previous hypothesis, the evidence, the files already inspected, the actions already attempted, and an instruction not to repeat them unless the evidence changed. It also narrows the offered tools to edit, read, and verify, withholding search and shell workarounds, and states that restating the fix in prose does not change the file.

`agent-run.js` and `progress.js` contain no reference to Luhn, `research.problem`, Qwen, or n8n.

## Anti-loop algorithm

A rolling window holds the last eight action fingerprints. A search fingerprint is the set of matched paths, so different queries that return the same files share a fingerprint. A repeated block of length two, three, or four escalates, which catches `search A, search B, read A, reason X` repeated even when no two consecutive calls are identical.

## Live comparison

Both runs used the same neutral goal, the same disposable fixture, the same model, and the same tool permissions. The goal describes the coding problem and the verification requirements. It does not mention external research, and it does not forbid editing. The baseline had no capability provider; the assisted run had the live n8n registry available.

| | baseline | assisted |
|---|---|---|
| AgentRun | `run_1ec3dd03aec9d5bd` | `run_8f5eb88b13e65859` |
| outcome | completed | completed |
| model turns | 12 | 13 |
| tool calls | 11 | 12 |
| failed attempts | 1 | 1 |
| repair iterations | 1 | 1 |
| research escalations | 0 | 0 |
| stagnant turns | 0 | 0 |
| repeated intent | 1 | 1 |
| tests | fail then pass | fail then pass |
| verification | passed | passed |
| files changed | `src/check.js` | `src/check.js` |
| elapsed | 285.9 s | 178.2 s |

Neither run became stagnant, so the runtime never had to request research. Both wrote a right-to-left implementation with the subtract-9 reduction, both passed the project tests, the hidden acceptance probe, and diagnostics, and both satisfied all five requirements before completing. The repeated-reasoning stall is gone: the previous attempts burned 40 turns and over 14 minutes without editing a file.

Live evidence is `packages/research-qualify/out/qualification.json`.

## The n8n round trip

Because a healthy model may solve this fixture without help, the external round trip is proven deterministically rather than by hoping the live model gets stuck. `packages/research-qualify/test/research-integration.test.js` scripts a model that repeats the same reasoning while alternating search and read. It asserts that CodeMe selects and invokes the capability itself, that the result is untrusted, that `recommended_fix` stays null, that the write happens after the evidence and is not runtime-directed, and that exactly one escalation occurs.

The live hub was verified separately. `research.problem` returned `status: ok` in 858 ms with the Wikipedia procedure and provenance, and discovery listed exactly `hub.health`, `research.problem`, `knowledge.lookup`, and `task.decompose`, each `risk: read` with no route exposed.

## Proof

`sh scripts/qualify-research.sh` runs the stagnation tests, the hub-unavailable fallback, the research integration test, the Gate 9 capability and registry tests, the Gate 8 foundation tests, the Gate 6 policy tests, the Gate 7 requirement tests, the AgentRun orchestration tests, and the live comparison.

| Check | Result |
|---|---|
| Semantic loop detection | A scripted repeat of the same reasoning reaches `research_needed` by turn 4, not after 4 repetitive turns. |
| Runtime-directed research | CodeMe builds the request from the record's schema and invokes it. The model did not choose it. |
| Untrusted evidence | The observation is `trusted: false` with a requestId, a runId, a duration, and bounded evidence. |
| One escalation per question | A second stagnation for the same problem terminates instead of researching again. |
| Evidence consumed | The brief appears in the next model prompt. |
| Terminates on failure | Continued non-progress ends `failed` with code `stagnation`, well before the iteration limit. |
| Context preserved | A repeated read still shows the contents. The earlier copy is the one collapsed. |
| Refused calls | `command_rejected` and `not_found` do not reset stagnation. |
| No write authority | The hub never changed a file. `filesChanged` comes from CodeMe `file.write` and matches the git diff. |
| Verification not weakened | Completion still requires a failing test, a repair, a passing test, clean diagnostics, the diff, the hidden probe, and every requirement. |
| Earlier gates | Gate 6 policy, Gate 7 requirements, Gate 8 foundation, Gate 9 registry, and the AgentRun orchestration tests pass, including both live Qwen checks. |

## Stopped here

The fixture was not modified to obtain a pass. Reserved capabilities remain catalog entries with no workflow.
