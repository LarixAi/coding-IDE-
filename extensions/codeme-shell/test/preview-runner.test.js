const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const net = require("net");
const { createPreviewRunner, portFromText, previewPlan, resolvePreviewUrl, recoverFlagSocket, ensureStaticPreview, entryPointFromStartScript, portFromSourceText, extractLocalAssets, isAssetFailure, hasOwnedPreviewTerminal, stopOwnedPreviewTerminals } = require("../preview-runner");

function mockVscode(commands) {
  const sent = [];
  const external = [];
  return {
    sent,
    external,
    vscode: {
      Uri: { parse: (value) => ({ toString: () => value, fsPath: value }) },
      commands: {
        executeCommand: async (name, value) => {
          commands.push({ name, value: value && value.toString ? value.toString() : value });
        },
      },
      env: {
        async openExternal(uri) {
          external.push(uri && uri.toString ? uri.toString() : String(uri));
          return true;
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
  assert.strictEqual(entryPointFromStartScript("node server.js"), "server.js");
  assert.strictEqual(entryPointFromStartScript("node --trace-warnings server.js"), "server.js");
  assert.strictEqual(portFromSourceText("server.listen(3000);"), 3000);
  assert.strictEqual(portFromSourceText("const PORT = process.env.PORT || 3000;\nserver.listen(PORT);"), 3000);
  assert.strictEqual(portFromSourceText("const port = 3001;\napp.listen(port);"), 3001);
  assert.strictEqual(isAssetFailure({ code: "asset_status" }), true);
  assert.strictEqual(isAssetFailure({ code: "connection_refused" }), false);

  let ownedDisposed = 0;
  let unrelatedDisposed = 0;
  const ownedMock = mockVscode([]);
  ownedMock.vscode.window.terminals.push(
    { name: "CodeMe Process", dispose() { ownedDisposed += 1; } },
    { name: "CodeMe Preview", dispose() { ownedDisposed += 1; } },
    { name: "User Terminal", dispose() { unrelatedDisposed += 1; } },
  );
  assert.strictEqual(hasOwnedPreviewTerminal(ownedMock.vscode), true);
  stopOwnedPreviewTerminals(ownedMock.vscode);
  assert.strictEqual(ownedDisposed, 2);
  assert.strictEqual(unrelatedDisposed, 0);

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

  const cssPlan = previewPlan(root, "styles.css");
  assert.strictEqual(cssPlan.ok, true);
  assert.strictEqual(cssPlan.url, "http://127.0.0.1:4173/");

  const jsUrl = resolvePreviewUrl(root, "http://localhost:4173/script.js", "http://127.0.0.1:4173");
  assert.strictEqual(jsUrl.ok, true);
  assert.strictEqual(jsUrl.url, "http://127.0.0.1:4173/");
  assert.strictEqual(jsUrl.canonicalizedFromAsset, "http://localhost:4173/script.js");

  const otherPort = previewPlan(root, "http://127.0.0.1:9");
  assert.strictEqual(otherPort.ok, true);
  assert.strictEqual(otherPort.shouldStart, false);

  const blocked = previewPlan(root, "https://example.com");
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, "invalid_url");

  const nodeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-node-preview-"));
  fs.writeFileSync(path.join(nodeRoot, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
  fs.writeFileSync(path.join(nodeRoot, "server.js"), "const PORT = process.env.PORT || 3000;\nserver.listen(PORT);\n");
  fs.writeFileSync(path.join(nodeRoot, "index.html"), "<title>Node Entry</title>");
  const nodePlan = previewPlan(nodeRoot, "index.html");
  assert.strictEqual(nodePlan.ok, true);
  assert.strictEqual(nodePlan.port, 3000);
  assert.strictEqual(nodePlan.url, "http://127.0.0.1:3000/");
  assert.strictEqual(nodePlan.command, "npm start");
  assert.strictEqual(nodePlan.shouldStart, true);

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

  const cssAsPreview = await staticRunner.check(staticRoot, "style.css");
  assert.strictEqual(cssAsPreview.available, true);
  assert.strictEqual(cssAsPreview.url.includes("/style.css"), false);
  assert.strictEqual(cssAsPreview.title, "Hello CodeMe");
  assert.deepStrictEqual(staticMock.sent, []);
  assert.strictEqual(staticMock.vscode.window.terminals.length, 0);
  const staticServer = await ensureStaticPreview(staticRoot, 4173);
  if (staticServer && staticServer.server) await new Promise((resolve) => staticServer.server.close(resolve));

  const assetRefs = extractLocalAssets(
    '<link rel="stylesheet" href="styles.css"><script src="script.js"></script>',
    "http://127.0.0.1:3000/",
  );
  assert.deepStrictEqual(assetRefs.map((item) => [item.kind, item.path]), [
    ["style", "styles.css"],
    ["script", "script.js"],
  ]);

  const assetsLive = await listen((req, res) => {
    if (req.url === "/styles.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end("body { color: green; }");
      return;
    }
    if (req.url === "/script.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end("document.body.dataset.ready = 'yes';");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<title>Assets</title><link rel="stylesheet" href="/styles.css"><script src="/script.js"></script>');
  });
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-assets-preview-"));
  fs.writeFileSync(path.join(assetRoot, "package.json"), JSON.stringify({ scripts: { start: `serve . -l ${assetsLive.port}` } }));
  const assetMock = mockVscode([]);
  const assetResult = await createPreviewRunner(assetMock.vscode).check(assetRoot, assetsLive.url);
  assert.strictEqual(assetResult.available, true);
  assert.strictEqual(assetResult.assets.length, 2);
  assert.ok(assetResult.assets.every((item) => item.ok));
  assert.deepStrictEqual(assetResult.assets.map((item) => item.path).sort(), ["script.js", "styles.css"]);
  await new Promise((resolve) => assetsLive.server.close(resolve));

  const brokenAssets = await listen((req, res) => {
    if (req.url === "/styles.css" || req.url === "/script.js") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>wrong asset</html>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<title>Broken Assets</title><link rel="stylesheet" href="/styles.css"><script src="/script.js"></script>');
  });
  const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-broken-assets-"));
  fs.writeFileSync(path.join(brokenRoot, "package.json"), JSON.stringify({ scripts: { start: `serve . -l ${brokenAssets.port}` } }));
  const brokenResult = await createPreviewRunner(mockVscode([]).vscode).check(brokenRoot, brokenAssets.url);
  assert.strictEqual(brokenResult.available, false);
  assert.strictEqual(brokenResult.code, "asset_mime");
  assert.ok(/styles\.css|script\.js/.test(brokenResult.message));
  await new Promise((resolve) => brokenAssets.server.close(resolve));

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
  assert.ok(commands.some((item) => item.name === "simpleBrowser.show" && item.value === live.url));
  assert.deepStrictEqual(mock.external, [], "Preview must not launch the system browser");
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

  const detectedPortServer = await listen((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<title>Detected Port</title>");
  });
  const detectedPort = detectedPortServer.port;
  await new Promise((resolve) => detectedPortServer.server.close(resolve));

  const detectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-detected-port-"));
  fs.writeFileSync(path.join(detectedRoot, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
  fs.writeFileSync(
    path.join(detectedRoot, "server.js"),
    `const PORT = process.env.PORT || ${detectedPort};\nserver.listen(PORT);\n`,
  );
  fs.writeFileSync(path.join(detectedRoot, "index.html"), "<title>Detected Port</title>");

  const detectedCommands = [];
  const detectedMock = mockVscode(detectedCommands);
  let detectedLaunched;
  detectedMock.vscode.window.createTerminal = function createTerminal(options) {
    const terminal = {
      name: options.name,
      show() {},
      sendText(command) {
        detectedMock.sent.push(command);
        detectedLaunched = http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<title>Detected Port</title>");
        });
        detectedLaunched.listen(detectedPort, "127.0.0.1");
      },
    };
    this.terminals.push(terminal);
    return terminal;
  };

  const detectedResult = await createPreviewRunner(detectedMock.vscode).check(detectedRoot, "index.html");
  assert.strictEqual(detectedResult.available, true);
  assert.strictEqual(detectedResult.statusCode, 200);
  assert.strictEqual(detectedResult.title, "Detected Port");
  assert.strictEqual(detectedMock.sent.length, 1);
  assert.strictEqual(detectedMock.sent[0], "npm start");
  if (detectedLaunched) await new Promise((resolve) => detectedLaunched.close(resolve));

  console.log("ok preview runner");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
