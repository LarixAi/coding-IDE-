const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const net = require("net");
const { createPreviewRunner, portFromText, previewPlan, recoverFlagSocket, ensureStaticPreview } = require("../preview-runner");

function mockVscode(commands) {
  const sent = [];
  return {
    sent,
    vscode: {
      Uri: { parse: (value) => ({ toString: () => value, fsPath: value }) },
      commands: {
        executeCommand: async (name, uri) => {
          commands.push({ name, uri: uri && uri.toString() });
        },
      },
      window: {
        terminals: [],
        createTerminal(options) {
          const terminal = {
            name: options.name,
            cwd: options.cwd,
            show() {},
            sendText(command) { sent.push(command); },
          };
          this.terminals.push(terminal);
          return terminal;
        },
      },
    },
  };
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, port, url: `http://127.0.0.1:${port}/` };
}

async function main() {
  assert.strictEqual(portFromText("serve src -l 4173"), 4173);
  assert.strictEqual(portFromText("Open http://localhost:4173"), 4173);
  assert.strictEqual(portFromText("node server.js"), 0);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-preview-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { start: "serve src -l 4173" } }));
  fs.writeFileSync(path.join(root, "README.md"), "Open http://localhost:4173\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.html"), "<title>Car Bid</title>");

  const filePlan = previewPlan(root, "file:///workspace/src/index.html");
  assert.strictEqual(filePlan.ok, true);
  assert.strictEqual(filePlan.url, "http://127.0.0.1:4173/");
  assert.strictEqual(filePlan.command, "npm start");
  assert.strictEqual(filePlan.shouldStart, true);

  const otherPort = previewPlan(root, "http://127.0.0.1:9");
  assert.strictEqual(otherPort.ok, true);
  assert.strictEqual(otherPort.shouldStart, false);

  const blocked = previewPlan(root, "https://example.com");
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, "invalid_url");

  if (process.platform !== "win32") {
    const socketRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-preview-socket-"));
    const socketPath = path.join(socketRoot, "--port");
    const socketServer = net.createServer();
    await new Promise((resolve, reject) => {
      socketServer.once("error", reject);
      socketServer.listen(socketPath, resolve);
    });
    let disposed = 0;
    const socketMock = mockVscode([]);
    socketMock.vscode.window.terminals.push({
      name: "CodeMe Preview",
      dispose() { disposed += 1; },
    });
    assert.strictEqual(fs.lstatSync(socketPath).isSocket(), true);
    assert.strictEqual(recoverFlagSocket(socketMock.vscode, socketRoot), true);
    assert.strictEqual(disposed, 1);
    assert.strictEqual(fs.existsSync(socketPath), false);
    await new Promise((resolve) => socketServer.close(resolve));
  }

  const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-static-preview-"));
  fs.writeFileSync(path.join(staticRoot, "index.html"), "<title>Hello CodeMe</title><h1>Hello CodeMe</h1>");
  fs.writeFileSync(path.join(staticRoot, "style.css"), "body { font-family: sans-serif; }");
  const staticCommands = [];
  const staticMock = mockVscode(staticCommands);
  const staticRunner = createPreviewRunner(staticMock.vscode);
  const staticPage = await staticRunner.check(staticRoot, "index.html");
  assert.strictEqual(staticPage.available, true);
  assert.strictEqual(staticPage.statusCode, 200);
  assert.strictEqual(staticPage.title, "Hello CodeMe");
  assert.deepStrictEqual(staticMock.sent, []);
  assert.strictEqual(staticMock.vscode.window.terminals.length, 0);
  const staticServer = await ensureStaticPreview(staticRoot, 4173);
  if (staticServer && staticServer.server) await new Promise((resolve) => staticServer.server.close(resolve));

  const live = await listen((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<title>Live Preview</title>");
  });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { start: `serve src -l ${live.port}` } }));
  const commands = [];
  const mock = mockVscode(commands);
  const runner = createPreviewRunner(mock.vscode);
  const page = await runner.check(root, "src/index.html");
  assert.strictEqual(page.available, true);
  assert.strictEqual(page.statusCode, 200);
  assert.strictEqual(page.title, "Live Preview");
  assert.deepStrictEqual(mock.sent, []);
  assert.ok(commands.some((item) => item.name === "vscode.open"));
  live.server.close();

  const down = await runner.check(root, "http://127.0.0.1:9");
  assert.strictEqual(down.available, false);
  assert.ok(["ECONNREFUSED", "connection_refused", "timeout"].includes(down.code), down.code);

  const starting = await listen((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<title>Started</title>");
  });
  const startPort = starting.port;
  await new Promise((resolve) => starting.server.close(resolve));
  const startRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-preview-start-"));
  fs.writeFileSync(path.join(startRoot, "package.json"), JSON.stringify({ scripts: { start: `serve src -l ${startPort}` } }));
  const startCommands = [];
  const startMock = mockVscode(startCommands);
  let launched;
  startMock.vscode.window.createTerminal = function createTerminal(options) {
    const terminal = {
      name: options.name,
      show() {},
      sendText(command) {
        startMock.sent.push(command);
        launched = http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<title>Started</title>");
        });
        launched.listen(startPort, "127.0.0.1");
      },
    };
    this.terminals.push(terminal);
    return terminal;
  };
  const started = await createPreviewRunner(startMock.vscode).check(startRoot, `http://127.0.0.1:${startPort}/`);
  assert.strictEqual(started.available, true);
  assert.strictEqual(startMock.sent[0], "npm start");
  assert.strictEqual(started.title, "Started");
  if (launched) await new Promise((resolve) => launched.close(resolve));

  console.log("ok preview runner");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
