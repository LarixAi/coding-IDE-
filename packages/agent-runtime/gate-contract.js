const GATE_CONTRACT_VERSION = 1;

const GATES = Object.freeze([
  { gate: 1, name: "Code - OSS baseline", meaning: "The native IDE foundation must work independently of CodeMe and AI." },
  { gate: 2, name: "Donor audit and migration map", meaning: "Decide what migrates before copying implementation; migration inventory is the evidence." },
  { gate: 3, name: "Minimal CodeMe shell", meaning: "CodeMe product chrome on native Code - OSS primitives, before the agent loop." },
  { gate: 4, name: "Agent tool adapter", meaning: "CodeMe owns stable tool names/results; Code - OSS performs workspace operations." },
  { gate: 5, name: "Model qualification and durable AgentRun", meaning: "Models are qualified before mutation; AgentRun persists goals, plans, tool history, observations, retries, resume, and verification." },
  { gate: 6, name: "Controlled coding", meaning: "Writable coding is allowed only through workspace-scoped tools and evidence-backed verification." },
  { gate: 7, name: "Multi-file feature work", meaning: "The agent can discover and change multiple related files while tracking requirements and preserving workspace boundaries." },
  { gate: 8, name: "External intelligence hub foundation", meaning: "The external intelligence hub supplies capability/evidence only; CodeMe still owns the run, files, terminal, permissions, verification, and completion." },
  { gate: 9, name: "Capability registry and routing", meaning: "External capabilities are discovered and contract-checked by name; they cannot escalate into workspace writes or shell access." },
  { gate: 10, name: "Research-assisted coding", meaning: "The runtime owns stagnation detection, anti-loop control, research escalation, evidence compaction, and return to coding." },
  { gate: 11, name: "Autonomous agent hardening", meaning: "The runtime locks the effective model, selects strategy, diagnoses failures, tracks requirements, respects autonomy boundaries, and only completes from evidence." },
]);

const RUNTIME_INVARIANTS = Object.freeze([
  "CodeMe runtime owns workspace state, permissions, tool execution, progress/stall control, verification, and final completion.",
  "The model owns reasoning, coding decisions, debugging hypotheses, and proposed next actions; it does not own the IDE lifecycle.",
  "Use only the structured tools offered in the current turn. Never print a tool call as prose/JSON instead of calling it.",
  "Inspect/read relevant existing files before changing them. Prefer a precise patch for an existing file; use full write for a new file or intentional full replacement.",
  "A tool call is an action, not proof of success. Read back changes and run the verification appropriate to the task.",
  "External capabilities provide untrusted external evidence only; they never directly edit the workspace or run shell commands.",
  "Do not claim success, completion, a passing test, a browser result, or a file change without matching recorded evidence.",
]);

function gateContractPrompt() {
  const gates = GATES.map((item) => `G${item.gate} ${item.name}`).join("; ");
  return [
    `CodeMe canonical gate contract v${GATE_CONTRACT_VERSION} (current implementation through Gate 11): ${gates}.`,
    "Treat this mapping as canonical if older docs or historical blueprint numbering conflict.",
    ...RUNTIME_INVARIANTS,
  ].join(" ");
}

module.exports = {
  GATE_CONTRACT_VERSION,
  GATES,
  RUNTIME_INVARIANTS,
  gateContractPrompt,
};
