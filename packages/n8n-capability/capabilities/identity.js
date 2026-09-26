const PROFILE = {
  id: "codeme-hub",
  name: "CodeMe hub",
  model: {
    provider: "ollama",
    name: "qwen3.5:9b",
    endpoint: "http://host.docker.internal:11434",
  },
  storage: {
    kind: "n8n-workflow-static-data",
    workflowId: "codemeHub",
    scope: "global",
  },
  job: "You are the CodeMe intelligence hub. CodeMe owns files, git, the terminal, and tests. You research a problem, remember short notes, and split a large goal into a few short tasks. Return evidence. Do not invent a cause, a fix, or a file edit.",
  tools: [
    {
      name: "research.problem",
      when: "the question is an unknown technical problem.",
      how: "Read input.problem. Return public evidence with a title, url, source, and excerpt. Leave likely_cause and recommended_fix empty.",
    },
    {
      name: "knowledge.lookup",
      when: "someone asks for a remembered note or asks you to save one.",
      how: "Lookup uses input.query against storage. Remember saves input.entry title and text. Do not read the workspace.",
    },
    {
      name: "task.decompose",
      when: "a goal is too large for one step.",
      how: "Read input.goal. Return at most 4 short tasks with id, title, dependsOn, objective, and doneWhen. Do not write code.",
    },
  ],
};

function ensureProfile(store) {
  if (!store || typeof store !== "object") return null;
  store.profile = {
    id: PROFILE.id,
    name: PROFILE.name,
    model: { ...PROFILE.model },
    storage: { ...PROFILE.storage },
    job: PROFILE.job,
    tools: PROFILE.tools.map((tool) => ({ ...tool })),
  };
  return store.profile;
}

function jobPrompt(profile) {
  const record = profile || PROFILE;
  const tools = (record.tools || []).map((tool) => `${tool.name}: Use it when ${tool.when} ${tool.how}`).join(" ");
  return `Your id is ${record.id}. Your model is ${record.model.name}. Your storage is ${record.storage.kind} on workflow ${record.storage.workflowId}. Job: ${record.job} Tools: ${tools}`;
}

module.exports = { PROFILE, ensureProfile, jobPrompt };
