"use strict";

const MODE_CONTRACTS = Object.freeze({
  chat: Object.freeze({
    key: "chat",
    label: "Chat",
    internalComposerMode: "ask",
    agentMode: "read_only",
    taskClass: "",
    mutation: "blocked",
    orchestrated: false,
    description: "Workspace-aware conversation and explanation without edits.",
  }),
  plan: Object.freeze({
    key: "plan",
    label: "Plan",
    internalComposerMode: "plan",
    agentMode: "read_only",
    taskClass: "plan",
    mutation: "blocked",
    orchestrated: false,
    description: "Inspect the project and produce an implementation plan without editing.",
  }),
  code: Object.freeze({
    key: "code",
    label: "Code",
    internalComposerMode: "code",
    agentMode: "controlled",
    taskClass: "",
    mutation: "allowed",
    orchestrated: false,
    description: "Implement the requested change and verify it.",
  }),
  debug: Object.freeze({
    key: "debug",
    label: "Debug",
    internalComposerMode: "debug",
    agentMode: "controlled",
    taskClass: "bug-fix",
    mutation: "after_failure_evidence",
    orchestrated: false,
    description: "Reproduce a failure before editing, then repair and re-run the original failing check.",
  }),
  multitask: Object.freeze({
    key: "multitask",
    label: "Multitask",
    internalComposerMode: "multitask",
    agentMode: "read_only",
    taskClass: "",
    mutation: "developer_role_only",
    orchestrated: true,
    description: "Coordinate the Paperclip product, architecture, development, test and review team.",
  }),
});

const MODE_ORDER = Object.freeze(["chat", "plan", "code", "debug", "multitask"]);

function visibleMode(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "ask" || text === "chat" || text === "chat_only" || !text) return "chat";
  if (text === "controlled") return "code";
  if (MODE_CONTRACTS[text]) return text;
  return "chat";
}

function internalComposerMode(value) {
  return MODE_CONTRACTS[visibleMode(value)].internalComposerMode;
}

function contractFor(value) {
  return MODE_CONTRACTS[visibleMode(value)];
}

function modeOptions() {
  return MODE_ORDER.map((key) => ({ ...MODE_CONTRACTS[key] }));
}

module.exports = {
  MODE_CONTRACTS,
  MODE_ORDER,
  contractFor,
  internalComposerMode,
  modeOptions,
  visibleMode,
};
