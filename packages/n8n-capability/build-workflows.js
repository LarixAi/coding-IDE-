const fs = require("fs");
const path = require("path");
const { jobPrompt, PROFILE } = require("./capabilities/identity");

const root = __dirname;
const workflowDir = path.join(root, "workflows");

const CAPABILITIES = [
  { name: "hub.health", description: "Echo a short token and report hub health" },
  { name: "research.problem", description: "Gather short evidence for a problem. Returns sources and excerpts, not a workspace edit." },
  { name: "knowledge.lookup", description: "Find a prior note by query, or remember a short note. Does not read the workspace." },
  { name: "task.decompose", description: "Split a large goal into a bounded task graph for one step at a time." },
];

function sourceOf(file) {
  const text = fs.readFileSync(path.join(root, "capabilities", file), "utf8");
  const cut = text.indexOf("module.exports");
  return text.slice(0, cut).trim();
}

function workflow({ id, versionId, name, webhookPath, webhookId, code, nodePrefix }) {
  return {
    id,
    versionId,
    name,
    active: false,
    nodeGroups: [],
    nodes: [
      {
        parameters: { httpMethod: "POST", path: webhookPath, responseMode: "responseNode", options: {} },
        id: `${nodePrefix}0001`,
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2.1,
        position: [0, 0],
        webhookId,
      },
      {
        parameters: { mode: "runOnceForAllItems", language: "javaScript", jsCode: code },
        id: `${nodePrefix}0002`,
        name: "Build response",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [280, 0],
      },
      {
        parameters: { respondWith: "json", responseBody: "={{ $json }}", options: {} },
        id: `${nodePrefix}0003`,
        name: "Respond",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1.5,
        position: [560, 0],
      },
    ],
    connections: {
      Webhook: { main: [[{ node: "Build response", type: "main", index: 0 }]] },
      "Build response": { main: [[{ node: "Respond", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  };
}

function failureTail(call) {
  return [
    "try {",
    `  return [{ json: await ${call} }];`,
    "} catch (error) {",
    "  return [{ json: { protocolVersion: 1, requestId: body.requestId, status: 'error', data: null, sources: [], warnings: [], error: { code: 'workflow_failed', message: String(error && error.message || error).slice(0, 300) }, duration: 1 } }];",
    "}",
  ];
}

const header = [
  "const item = $input.first().json;",
  "const body = item.body && item.body.requestId ? item.body : item;",
];

const researchCode = [
  ...header,
  "const httpRequest = async (options) => helpers.httpRequest(Object.assign({ method: 'GET', json: true, timeout: 8000 }, options));",
  sourceOf("research.js"),
  ...failureTail("researchProblem(body, httpRequest)"),
].join("\n");

const knowledgeCode = [
  ...header,
  "const store = $getWorkflowStaticData('global');",
  sourceOf("knowledge.js"),
  "try {",
  "  return [{ json: lookupKnowledge(body, store) }];",
  "} catch (error) {",
  "  return [{ json: { protocolVersion: 1, requestId: body.requestId, status: 'error', data: null, sources: [], warnings: [], error: { code: 'workflow_failed', message: String(error && error.message || error).slice(0, 300) }, duration: 1 } }];",
  "}",
].join("\n");

const decomposeCode = [
  ...header,
  `const HUB_BRIEF = ${JSON.stringify(jobPrompt(PROFILE))};`,
  "const complete = async (payload) => helpers.httpRequest({ method: 'POST', url: 'http://host.docker.internal:11434/api/chat', body: payload, json: true, timeout: 70000 });",
  sourceOf("decompose.js"),
  ...failureTail("decomposeGoal(body, complete, HUB_BRIEF)"),
].join("\n");

const identityCode = [
  ...header,
  "const store = $getWorkflowStaticData('global');",
  sourceOf("identity.js"),
  "const profile = ensureProfile(store);",
  "const warnings = [];",
  "if (!store.told) {",
  "  try {",
  "    const response = await helpers.httpRequest({",
  "      method: 'POST',",
  "      url: profile.model.endpoint + '/api/chat',",
  "      body: {",
  "        model: profile.model.name,",
  "        stream: false,",
  "        think: false,",
  "        options: { temperature: 0, num_predict: 180 },",
  "        messages: [",
  "          { role: 'system', content: jobPrompt(profile) },",
  "          { role: 'user', content: 'State your id, your job in one sentence, and name one tool with how you use it. Do not write code.' },",
  "        ],",
  "      },",
  "      json: true,",
  "      timeout: 70000,",
  "    });",
  "    const text = response && response.message && response.message.content ? String(response.message.content) : '';",
  "    store.acknowledgement = text.replace(/\\s+/g, ' ').trim().slice(0, 600);",
  "    store.told = Boolean(store.acknowledgement);",
  "  } catch (error) {",
  "    warnings.push(String(error && error.message || error).slice(0, 200) || 'The model was unreachable');",
  "  }",
  "}",
  "return [{ json: { protocolVersion: 1, requestId: body.requestId, status: 'ok', data: { profile: store.profile, acknowledgement: store.acknowledgement || '', told: Boolean(store.told) }, sources: [], warnings, error: null, duration: 1 } }];",
].join("\n");

const discoveryCode = [
  ...header,
  "if (body.capability && body.capability !== 'hub.discover') {",
  "  return [{ json: { protocolVersion: 1, requestId: body.requestId, status: 'error', data: null, sources: [], warnings: [], error: { code: 'capability_unavailable', message: 'This workflow only serves hub.discover' }, duration: 1 } }];",
  "}",
  `const capabilities = ${JSON.stringify(CAPABILITIES)};`,
  "return [{ json: { protocolVersion: 1, requestId: body.requestId, status: 'ok', data: { capabilities }, sources: [], warnings: [], error: null, duration: 1 } }];",
].join("\n");

const files = {
  "research-problem.json": workflow({
    id: "c0de4e01-3333-4000-8000-000000000030",
    versionId: "c0de4e01-3333-4000-8000-000000000031",
    name: "CodeMe research problem",
    webhookPath: "codeme-research-problem",
    webhookId: "codeme-research-problem",
    code: researchCode,
    nodePrefix: "c0de4e01-0003-4000-8000-",
  }),
  "knowledge-lookup.json": workflow({
    id: "codemeKnowledge",
    versionId: "codemeKnowledgeV1",
    name: "CodeMe knowledge lookup",
    webhookPath: "codeme-knowledge-lookup",
    webhookId: "codeme-knowledge-lookup",
    code: knowledgeCode,
    nodePrefix: "c0de4e01-0004-4000-8000-",
  }),
  "task-decompose.json": workflow({
    id: "c0de4e01-5555-4000-8000-000000000050",
    versionId: "c0de4e01-5555-4000-8000-000000000051",
    name: "CodeMe task decompose",
    webhookPath: "codeme-task-decompose",
    webhookId: "codeme-task-decompose",
    code: decomposeCode,
    nodePrefix: "c0de4e01-0005-4000-8000-",
  }),
  "hub-identity.json": workflow({
    id: "codemeHub",
    versionId: "codemeHubV1",
    name: "CodeMe hub identity",
    webhookPath: "codeme-hub-identity",
    webhookId: "codeme-hub-identity",
    code: identityCode,
    nodePrefix: "c0de4e01-0006-4000-8000-",
  }),
  "capabilities.json": workflow({
    id: "c0de4e01-2222-4000-8000-000000000020",
    versionId: "c0de4e01-2222-4000-8000-000000000021",
    name: "CodeMe capability discovery",
    webhookPath: "codeme-capabilities",
    webhookId: "codeme-capabilities",
    code: discoveryCode,
    nodePrefix: "c0de4e01-0002-4000-8000-",
  }),
};

for (const [name, value] of Object.entries(files)) {
  fs.writeFileSync(path.join(workflowDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

module.exports = { CAPABILITIES };
