const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const http = require("http");
const { executeReadOnly } = require("../agent-tools");

const MODEL = process.env.CODEME_QWEN_MODEL || "qwen3.5:9b";
const OLLAMA = process.env.CODEME_OLLAMA_URL || "http://127.0.0.1:11434";
const FIXTURE = path.join(__dirname, "fixture");

const PROVIDER_NAMES = {
  "file.read": "file_read",
  "repo.search": "repo_search",
  "git.status": "git_status",
  "git.diff": "git_diff",
  "diagnostics.run": "diagnostics_run",
  "browser.check": "browser_check",
};
const CONTRACT_NAMES = Object.fromEntries(Object.entries(PROVIDER_NAMES).map(([contract, provider]) => [provider, contract]));

const TOOLS = [
  tool("file_read", "Read a workspace-relative text file.", { path: { type: "string" } }, ["path"]),
  tool("repo_search", "Search workspace files for a text query.", { query: { type: "string" } }, ["query"]),
  tool("git_status", "Show git status for the workspace.", {}, []),
  tool("git_diff", "Show the working tree diff.", {}, []),
  tool("diagnostics_run", "List diagnostics. This fixture has none.", {}, []),
  tool("browser_check", "Check a running page. Unavailable in this qualification.", { url: { type: "string" } }, ["url"]),
];

function tool(name, description, properties, required) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required },
    },
  };
}

function request(method, pathname, body) {
  const url = new URL(pathname, OLLAMA);
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`${method} ${pathname} returned ${res.statusCode}: ${text.slice(0, 400)}`));
            return;
          }
          resolve(text ? JSON.parse(text) : {});
        });
      },
    );
    req.setTimeout(180000, () => {
      req.destroy(new Error("model request timed out"));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createHost(root) {
  return {
    async readFile(filePath) {
      const full = path.resolve(root, filePath);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        throw Object.assign(new Error(`File not found: ${filePath}`), { code: "not_found" });
      }
      return { path: filePath, contents: fs.readFileSync(full, "utf8") };
    },
    async search(query) {
      const matches = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === ".git") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) {
            const text = fs.readFileSync(full, "utf8");
            text.split(/\r?\n/).forEach((line, index) => {
              if (line.includes(query) && matches.length < 20) {
                matches.push({ path: path.relative(root, full), line: index + 1, text: line });
              }
            });
          }
        }
      };
      walk(root);
      return { query, matches };
    },
    async gitStatus() {
      const porcelain = cp.execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
      return { porcelain };
    },
    async gitDiff() {
      const diff = cp.execFileSync("git", ["diff"], { cwd: root, encoding: "utf8" });
      return { diff };
    },
    async diagnostics() {
      return { items: [] };
    },
    async browserCheck(url) {
      return { available: false, code: "browser_unavailable", message: "No browser runner is configured", url };
    },
  };
}

function prepareWorkspace() {
  const workspace = fs.mkdtempSync(path.join(require("os").tmpdir(), "codeme-qwen-"));
  fs.cpSync(FIXTURE, workspace, { recursive: true });
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  cp.execFileSync("git", ["init", "-b", "main"], { cwd: workspace });
  cp.execFileSync("git", ["add", "."], { cwd: workspace });
  cp.execFileSync("git", ["commit", "-m", "init"], { cwd: workspace, env: gitEnv, stdio: "ignore" });
  return workspace;
}

function snapshot(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(`${path.relative(root, full)}:${fs.readFileSync(full)}`);
    }
  };
  walk(root);
  return files.sort().join("\n");
}

async function chat(messages, withTools) {
  const body = { model: MODEL, stream: false, think: false, messages };
  if (withTools) body.tools = TOOLS;
  const response = await request("POST", "/api/chat", body);
  return response.message || {};
}

async function runTask(host, user) {
  const messages = [
    {
      role: "system",
      content: "You are qualifying against a local workspace. Use tools for repository facts. Never invent file contents or a successful tool result. If a tool fails, say so.",
    },
    { role: "user", content: user },
  ];
  const calls = [];
  for (let step = 0; step < 6; step++) {
    const message = await chat(messages, true);
    messages.push(message);
    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) {
      return { text: stripThinking(message.content || ""), calls, messages };
    }
    for (const call of toolCalls) {
      const providerName = call.function && call.function.name;
      const contractName = CONTRACT_NAMES[providerName] || providerName;
      const rawArgs = call.function ? call.function.arguments || {} : {};
      let args = {};
      try {
        args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
      } catch (error) {
        args = {};
      }
      const result = await executeReadOnly(host, contractName, args);
      calls.push({ tool: contractName, args, result });
      messages.push({ role: "tool", tool_name: providerName, content: JSON.stringify(result) });
    }
  }
  return { text: "", calls, messages, truncated: true };
}

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function used(calls, tool) {
  return calls.some((call) => call.tool === tool);
}

async function main() {
  const record = {
    model: MODEL,
    endpoint: OLLAMA,
    checkedAt: new Date().toISOString(),
    checks: [],
    grade: "chat_only",
  };

  const tags = await request("GET", "/api/tags").catch((error) => {
    record.checks.push({ name: "connect", pass: false, detail: error.message });
    return null;
  });
  if (!tags) return finish(record, null);

  const installed = (tags.models || []).some((model) => model.name === MODEL || model.name.startsWith(`${MODEL}:`) || model.model === MODEL);
  if (!installed) {
    record.checks.push({ name: "connect", pass: false, detail: `${MODEL} is not installed` });
    return finish(record, null);
  }

  try {
    console.error("check: connect");
    const ping = await chat([{ role: "user", content: "Reply with exactly: pong" }], false);
    const text = stripThinking(ping.content || "");
    const pass = text.toLowerCase().includes("pong");
    record.checks.push({ name: "connect", pass, detail: text.slice(0, 200) });
    if (!pass) return finish(record, null);
  } catch (error) {
    record.checks.push({ name: "connect", pass: false, detail: error.message });
    return finish(record, null);
  }

  const workspace = prepareWorkspace();
  const before = snapshot(workspace);
  const host = createHost(workspace);
  try {
    console.error("check: identify project");
    const project = await runTask(host, "What is the npm package name of this workspace? Use a tool. Reply with the name only.");
    record.checks.push({
      name: "identify project",
      pass: project.text.includes("badge-demo") && (used(project.calls, "file.read") || used(project.calls, "repo.search")),
      detail: project.text.slice(0, 300),
      tools: project.calls.map((call) => call.tool),
    });

    console.error("check: locate implementation");
    const locate = await runTask(host, "Where is the Badge component implemented? Use tools. Reply with the workspace-relative path only.");
    record.checks.push({
      name: "locate implementation",
      pass: locate.text.includes("src/components/Badge.tsx") && (used(locate.calls, "file.read") || used(locate.calls, "repo.search")),
      detail: locate.text.slice(0, 300),
      tools: locate.calls.map((call) => call.tool),
    });

    const disciplined = record.checks.filter((check) => check.name === "identify project" || check.name === "locate implementation").every((check) => check.pass);
    record.checks.push({ name: "use search or read tools", pass: disciplined, detail: disciplined ? "Both answers used repository tools" : "A required answer did not use file.read or repo.search" });

    console.error("check: grounded plan");
    const plan = await runTask(host, "Write a one-sentence plan to change the text the Badge component renders. Name the file you would edit. Do not edit anything.");
    const mutated = plan.calls.some((call) => call.tool === "file.write" && call.result.ok);
    record.checks.push({
      name: "grounded plan",
      pass: plan.text.includes("Badge.tsx") && !mutated,
      detail: plan.text.slice(0, 300),
      tools: plan.calls.map((call) => call.tool),
    });

    console.error("check: report tool failure");
    const failure = await runTask(host, "Read src/missing.txt and quote it. If the tool fails, reply exactly TOOL_FAILED and do not invent contents.");
    const failedRead = failure.calls.find((call) => call.tool === "file.read" && call.args.path === "src/missing.txt" && call.result.ok === false);
    const invented = /contents are|the file says|here is the file/i.test(failure.text) && !failure.text.includes("TOOL_FAILED");
    record.checks.push({
      name: "report tool failure",
      pass: Boolean(failedRead) && failure.text.includes("TOOL_FAILED") && !invented,
      detail: failure.text.slice(0, 300),
      tools: failure.calls.map((call) => `${call.tool}:${call.result.ok}`),
    });

    const after = snapshot(workspace);
    record.workspaceUnchanged = before === after;
    const passed = record.checks.every((check) => check.pass) && record.workspaceUnchanged;
    record.grade = passed ? "read_only_qualified" : "limited_agent";
  } catch (error) {
    record.checks.push({ name: "harness", pass: false, detail: error.message });
    record.grade = record.checks.some((check) => check.pass) ? "limited_agent" : "chat_only";
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  return finish(record);
}

function finish(record) {
  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "qualification.json");
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  const gradeFile = path.join(__dirname, "../../extensions/codeme-shell/model-grade.json");
  fs.writeFileSync(gradeFile, JSON.stringify({ model: record.model, grade: record.grade, checkedAt: record.checkedAt }, null, 2));
  console.log(JSON.stringify(record, null, 2));
  return record;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
