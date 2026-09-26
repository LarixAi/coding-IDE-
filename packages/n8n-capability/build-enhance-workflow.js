const fs = require("fs");
const path = require("path");

const OLLAMA = "http://host.docker.internal:11434/api/generate";

function codeNode(name, id, position, jsCode) {
  return {
    parameters: { mode: "runOnceForAllItems", language: "javaScript", jsCode },
    id,
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
  };
}

const shared = `
function clip(value, limit) {
  return String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
}
function readBody(item) {
  const body = item.body && (item.body.raw_prompt || item.body.project_type || item.body.active_file) ? item.body : item;
  return {
    raw_prompt: clip(body.raw_prompt, 4000),
    active_file: clip(body.active_file, 240),
    selected_code: String(body.selected_code || "").slice(0, 8000),
    project_type: clip(body.project_type, 40) || "nodejs",
  };
}
function stripModel(text) {
  return String(text || "").replace(/<think>[\\s\\S]*?<\\/think>/g, "").trim();
}
function stripFences(text) {
  const source = stripModel(text);
  const match = /\`\`\`[a-zA-Z0-9]*\\n?([\\s\\S]*?)\`\`\`/.exec(source);
  return (match ? match[1] : source).trim();
}
async function ollama(prompt, limit) {
  const response = await helpers.httpRequest({
    method: "POST",
    url: ${JSON.stringify(OLLAMA)},
    body: {
      model: "qwen3.5:9b",
      prompt,
      stream: false,
      think: false,
      options: { temperature: 0.2, top_p: 0.9, num_predict: limit },
    },
    json: true,
    timeout: 70000,
  });
  return stripModel(response && (response.response || response.message && response.message.content) || "");
}
`.trim();

const decompose = `
${shared}
const input = readBody($input.first().json);
if (!input.raw_prompt) {
  return [{ json: { status: "error", error: "raw_prompt is required", ...input, subtasks: [] } }];
}
let subtasks = [];
try {
  const raw = await ollama(
    "Break the user request into explicit sub-tasks:\\n1. Inputs & Arguments\\n2. Validation Logic\\n3. Main Business Logic / Route Handler\\n4. Error Handling & Response Format\\nReturn JSON only: {\\"subtasks\\":[\\"\\"]}\\n\\nRequest:\\n" + input.raw_prompt,
    400
  );
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const parsed = JSON.parse(raw.slice(start, end + 1));
  subtasks = Array.isArray(parsed.subtasks) ? parsed.subtasks.map((item) => clip(item, 300)).filter(Boolean).slice(0, 8) : [];
  if (!subtasks.length && Array.isArray(parsed)) subtasks = parsed.map((item) => clip(item, 300)).filter(Boolean).slice(0, 8);
} catch (error) {
  return [{ json: { status: "error", error: clip(error && error.message, 300) || "decomposition failed", ...input, subtasks: [] } }];
}
if (!subtasks.length) {
  return [{ json: { status: "error", error: "The model did not return sub-tasks", ...input, subtasks: [] } }];
}
return [{ json: { status: "ok", ...input, subtasks } }];
`.trim();

const enrich = `
${shared}
const state = $input.first().json;
if (state.status === "error") return [{ json: state }];
const warnings = [];
let docs = "";
try {
  const query = (state.project_type + " " + state.raw_prompt).slice(0, 180);
  const payload = await helpers.httpRequest({
    method: "GET",
    url: "https://api.duckduckgo.com/?q=" + encodeURIComponent(query) + "&format=json&no_html=1&skip_disambig=1",
    json: true,
    timeout: 8000,
  });
  const bits = [];
  if (payload && payload.AbstractText) bits.push(clip(payload.Heading, 120) + ": " + clip(payload.AbstractText, 500));
  for (const topic of (payload && payload.RelatedTopics) || []) {
    if (bits.length >= 3) break;
    if (topic && topic.Text) bits.push(clip(topic.Text, 240));
  }
  docs = bits.join("\\n");
} catch (error) {
  warnings.push("Documentation lookup failed: " + (clip(error && error.message, 160) || "request failed"));
}
const standards = {
  nodejs: "Use clear functions, validate inputs, return explicit errors, and avoid unused variables.",
  javascript: "Use clear functions, validate inputs, and return explicit errors.",
  typescript: "Use TypeScript strict mode, explicit types, and ES module syntax.",
  python: "Use type hints, validate inputs, and raise specific exceptions.",
}[String(state.project_type || "").toLowerCase()] || "Write clean, robust code and handle errors explicitly.";
const fileContext = [
  "Active file: " + (state.active_file || "(none)"),
  "Selected code:",
  state.selected_code || "(none)",
].join("\\n");
return [{ json: { ...state, docs, standards, file_context: fileContext, warnings } }];
`.trim();

const assemble = `
${shared}
const state = $input.first().json;
if (state.status === "error") return [{ json: state }];
const enhanced_prompt = [
  "### SYSTEM",
  "You are an expert software engineer writing clean, robust code for " + state.project_type + ".",
  "Follow the provided context carefully.",
  "Output valid code only.",
  "",
  "CONTEXT",
  state.standards || "",
  state.docs || "(no documentation excerpt)",
  state.file_context || "",
  "",
  "SUB-TASKS",
  (state.subtasks || []).map((item, index) => (index + 1) + ". " + item).join("\\n"),
  "",
  "USER REQUEST",
  state.raw_prompt,
].join("\\n");
return [{ json: { ...state, enhanced_prompt } }];
`.trim();

const generate = `
${shared}
function lintCode(code, projectType) {
  const type = String(projectType || "").toLowerCase();
  if (type && !/js|node|javascript/.test(type)) return { ok: true, skipped: true, errors: [] };
  try {
    new Function(code);
    return { ok: true, skipped: false, errors: [] };
  } catch (error) {
    return { ok: false, skipped: false, errors: [clip(error && error.message, 300)] };
  }
}
function unifiedDiff(before, after, filename) {
  const file = filename || "generated.txt";
  const added = String(after || "").split("\\n");
  const removed = String(before || "").split("\\n");
  const lines = ["diff --git a/" + file + " b/" + file, "--- a/" + file, "+++ b/" + file];
  if (!before) {
    lines.push("@@ -0,0 +1," + added.length + " @@");
    for (const line of added) lines.push("+" + line);
    return lines.join("\\n");
  }
  lines.push("@@ -1," + removed.length + " +1," + added.length + " @@");
  for (const line of removed) lines.push("-" + line);
  for (const line of added) lines.push("+" + line);
  return lines.join("\\n");
}
const state = $input.first().json;
if (state.status === "error") {
  return [{ json: { status: "error", error: state.error, subtasks_processed: state.subtasks || [], enhanced_prompt: state.enhanced_prompt || "", generated_code: "", unit_tests: "", git_diff: "", lint: null } }];
}
let generated = "";
try {
  generated = stripFences(await ollama(state.enhanced_prompt + "\\n\\nOutput valid code only.", 800));
} catch (error) {
  return [{ json: { status: "error", error: clip(error && error.message, 300) || "model call failed", subtasks_processed: state.subtasks, enhanced_prompt: state.enhanced_prompt, generated_code: "", unit_tests: "", git_diff: "", lint: null } }];
}
let lint = lintCode(generated, state.project_type);
if (!lint.ok) {
  try {
    const repaired = stripFences(await ollama(state.enhanced_prompt + "\\n\\nThe previous code failed a syntax check: " + lint.errors.join(" ") + "\\nReturn corrected code only.", 800));
    if (repaired) {
      generated = repaired;
      lint = lintCode(generated, state.project_type);
    }
  } catch (error) {
    (state.warnings || []).push("Repair call failed: " + clip(error && error.message, 160));
  }
}
let unitTests = "";
try {
  unitTests = stripFences(await ollama("Write unit tests for this implementation. Output test code only.\\n\\n" + generated, 500));
} catch (error) {
  (state.warnings || []).push("Unit test call failed: " + clip(error && error.message, 160));
}
const gitDiff = unifiedDiff(state.selected_code, generated, state.active_file || "generated.txt");
return [{
  json: {
    status: generated ? "success" : "error",
    error: generated ? null : "The model returned no code",
    subtasks_processed: state.subtasks,
    enhanced_prompt: state.enhanced_prompt,
    generated_code: generated,
    unit_tests: unitTests,
    git_diff: gitDiff,
    lint,
    warnings: state.warnings || [],
  },
}];
`.trim();

const workflow = {
  id: "codemeEnhance",
  versionId: "codemeEnhanceV1",
  name: "CodeMe enhance and code",
  active: false,
  nodeGroups: [],
  nodes: [
    {
      parameters: { httpMethod: "POST", path: "api/v1/enhance-and-code", responseMode: "responseNode", options: {} },
      id: "c0de4e02-0006-4000-8000-000000000001",
      name: "IDE webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2.1,
      position: [0, 0],
      webhookId: "api/v1/enhance-and-code",
    },
    codeNode("Decompose sub-tasks", "c0de4e02-0006-4000-8000-000000000002", [280, 0], decompose),
    codeNode("Enrich context", "c0de4e02-0006-4000-8000-000000000003", [560, 0], enrich),
    codeNode("Assemble prompt", "c0de4e02-0006-4000-8000-000000000004", [840, 0], assemble),
    codeNode("Qwen generate and verify", "c0de4e02-0006-4000-8000-000000000005", [1120, 0], generate),
    {
      parameters: { respondWith: "json", responseBody: "={{ $json }}", options: {} },
      id: "c0de4e02-0006-4000-8000-000000000006",
      name: "Respond to IDE",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.5,
      position: [1400, 0],
    },
  ],
  connections: {
    "IDE webhook": { main: [[{ node: "Decompose sub-tasks", type: "main", index: 0 }]] },
    "Decompose sub-tasks": { main: [[{ node: "Enrich context", type: "main", index: 0 }]] },
    "Enrich context": { main: [[{ node: "Assemble prompt", type: "main", index: 0 }]] },
    "Assemble prompt": { main: [[{ node: "Qwen generate and verify", type: "main", index: 0 }]] },
    "Qwen generate and verify": { main: [[{ node: "Respond to IDE", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
};

const out = path.join(__dirname, "workflows", "enhance-and-code.json");
fs.writeFileSync(out, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(out);
