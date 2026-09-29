const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { createPreviewSessionManager } = require("../preview-session-manager");
const { createPreviewRunner, resolveOwnedPreviewUrl } = require("../preview-runner");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function createFakeVscode(port, responseStatus) {
  const terminals = [];
  const commands = [];
  let terminalStarts = 0;

  const vscode = {
    commands: {
      async executeCommand(name, value) {
        commands.push({ name, value });
      },
    },
    window: {
      terminals,
      createTerminal(options) {
        terminalStarts += 1;
        let server = null;
        let command = "";
        const execution = {
          async *read() {
            yield `[fake process] ${command || "starting"}\n`;
          },
        };
        const terminal = {
          name: options.name,
          shellIntegration: {
            executeCommand(nextCommand) {
              command = nextCommand;
              server = http.createServer((_req, res) => {
                const status = Number(responseStatus.value);
                res.writeHead(status, { "Content-Type": "text/html" });
                res.end(status >= 500
                  ? "<h1>Server failure</h1>"
                  : "<title>Owned Session</title><h1>CodeMe Test Heading</h1>");
              });
              server.listen(port, "127.0.0.1");
              return execution;
            },
          },
          show() {},
          dispose() {
            if (server && server.listening) {
              try { server.close(); } catch {}
            }
          },
        };
        terminals.push(terminal);
        return terminal;
      },
      onDidEndTerminalShellExecution() {
        return { dispose() {} };
      },
      onDidChangeTerminalShellIntegration() {
        return { dispose() {} };
      },
    },
  };

  return {
    vscode,
    commands,
    get terminalStarts() { return terminalStarts; },
  };
}

async function main() {
  // Static workspaces also register with the same session manager.
  const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-session-static-"));
  fs.writeFileSync(path.join(staticRoot, "index.html"), "<title>Static</title><h1>Static</h1>");
  const staticFake = createFakeVscode(await freePort(), { value: 200 });
  const staticSessions = createPreviewSessionManager(staticFake.vscode);
  const staticStart = await staticSessions.start(staticRoot, "");
  assert.strictEqual(staticStart.started, true);
  assert.strictEqual(staticStart.kind, "static");
  assert.strictEqual(staticStart.status, "running");
  assert.ok(staticStart.sessionId);
  const staticStatus = staticSessions.status(staticRoot);
  const staticLogs = staticSessions.logs(staticRoot);
  assert.strictEqual(staticStatus.sessionId, staticLogs.sessionId);
  assert.strictEqual(staticStatus.sessionId, staticStart.sessionId);
  const staticPreview = await createPreviewRunner(staticFake.vscode).check(staticRoot, `${staticStatus.origin}/`);
  assert.strictEqual(staticPreview.available, true);
  assert.strictEqual(staticFake.terminalStarts, 0, "browser verification must not create a process terminal");
  await staticSessions.stop(staticRoot);

  // A common plain-site layout keeps the entrypoint under public/. The owned
  // preview must publish that canonical page instead of returning a 404 at /.
  const publicRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-session-public-"));
  fs.mkdirSync(path.join(publicRoot, "public"), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, "public", "index.html"), "<title>Public</title><h1>CodeMe Final Test</h1>");
  fs.writeFileSync(path.join(publicRoot, "public", "style.css"), "body { font-family: sans-serif; }");
  const publicFake = createFakeVscode(await freePort(), { value: 200 });
  const publicSessions = createPreviewSessionManager(publicFake.vscode);
  const publicStart = await publicSessions.start(publicRoot, "");
  assert.strictEqual(publicStart.kind, "static");
  assert.ok(publicStart.url.endsWith("/public/"), publicStart.url);
  assert.strictEqual(publicSessions.status(publicRoot).url, publicStart.url);
  assert.strictEqual(
    resolveOwnedPreviewUrl(publicSessions.status(publicRoot), "http://127.0.0.1:8080/"),
    publicStart.url,
    "model-invented localhost ports must resolve to the owned preview URL",
  );
  const publicPreview = await createPreviewRunner(publicFake.vscode).check(publicRoot, publicStart.url);
  assert.strictEqual(publicPreview.available, true, JSON.stringify(publicPreview));
  assert.strictEqual(publicPreview.statusCode, 200);
  await publicSessions.stop(publicRoot);

  // Dynamic server: one owned session, 500 does not trigger a second start, and
  // restart keeps the same session identity after the repair.
  const port = await freePort();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-session-dynamic-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
  fs.writeFileSync(path.join(root, "server.js"), `const http = require("http");\nhttp.createServer(() => {}).listen(${port});\n`);

  const responseStatus = { value: 500 };
  const fake = createFakeVscode(port, responseStatus);
  const sessions = createPreviewSessionManager(fake.vscode);
  const preview = createPreviewRunner(fake.vscode);

  const first = await sessions.start(root, "");
  assert.strictEqual(first.started, true);
  assert.strictEqual(first.status, "running");
  assert.strictEqual(first.command, "npm start");
  assert.strictEqual(fake.terminalStarts, 1);
  const sessionId = first.sessionId;

  const status = sessions.status(root);
  const logs = sessions.logs(root);
  assert.strictEqual(status.sessionId, sessionId);
  assert.strictEqual(logs.sessionId, sessionId);
  assert.match(logs.output, /npm start/);

  const failedCheck = await preview.check(root, `http://127.0.0.1:${port}/`);
  assert.strictEqual(failedCheck.available, false);
  assert.strictEqual(failedCheck.code, "page_status");
  assert.strictEqual(failedCheck.statusCode, 500);
  assert.strictEqual(fake.terminalStarts, 1, "HTTP 500 must not cause another application start");

  responseStatus.value = 200;
  const restarted = await sessions.start(root, "");
  assert.strictEqual(restarted.started, true);
  assert.strictEqual(restarted.restarted, true);
  assert.strictEqual(restarted.sessionId, sessionId, "restart must preserve the owned session identity");
  assert.strictEqual(restarted.restartCount, 1);
  assert.strictEqual(fake.terminalStarts, 2);

  const after = await preview.check(root, `http://127.0.0.1:${port}/`);
  assert.strictEqual(after.available, true);
  assert.strictEqual(after.statusCode, 200);
  assert.strictEqual(fake.terminalStarts, 2, "successful browser verification must not start a third process");
  assert.strictEqual(sessions.status(root).sessionId, sessionId);
  assert.strictEqual(sessions.logs(root).sessionId, sessionId);

  await sessions.stop(root);
  console.log("ok unified preview session lifecycle");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
