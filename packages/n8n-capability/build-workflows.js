const fs = require("fs");
const path = require("path");

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
  "const httpRequest = async (options) => $helpers.httpRequest(Object.assign({ method: 'GET', json: true, timeout: 8000 }, options));",
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
  "const complete = async (payload) => $helpers.httpRequest({ method: 'POST', url: 'http://host.docker.internal:11434/api/chat', body: payload, json: true, timeout: 25000 });",
  sourceOf("decompose.js"),
  ...failureTail("decomposeGoal(body, complete)"),
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
    id: "c0de4e01-4444-4000-8000-000000000040",
    versionId: "c0de4e01-4444-4000-8000-000000000041",
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
