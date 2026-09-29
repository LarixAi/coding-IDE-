const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const net = require("net");
const {
  createPreviewRunner,
  portFromText,
  previewPlan,
  resolvePreviewUrl,
  recoverFlagSocket,
  ensureStaticPreview,
  entryPointFromStartScript,
  portFromSourceText,
  extractLocalAssets,
  isAssetFailure,
} = require("../preview-runner");

function mockVscode(commands) {
  let terminalStarts = 0;
  return {
    get terminalStarts() { return terminalStarts; },
    vscode: {
      commands: {
        executeCommand: async (name, value) => {
          commands.push({ name, value: value && value.toString ? value.toString() : value });
        },
      },
      window: {
        terminals: [],
        createTerminal() {
          terminalStarts += 1;
          throw new Error("browser.check must never create a terminal");
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
  assert.strictEqual(isAssetFailure({ code: "asset_status" }), true);
  assert.strictEqual(isAssetFailure({ code: "page_status" }), false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-preview-pure-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
  fs.writeFileSync(path.join(root, "server.js"), "const PORT = process.env.PORT || 3000;\nserver.listen(PORT);\n");
  fs.mkdirSync(path.join(root, "public"));
  fs.writeFileSync(path.join(root, "public", "index.html"), "<title>Pure Preview</title><h1>Pure Preview</h1>");

  const plan = previewPlan(root, "public/index.html");
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.port, 3000);
  assert.strictEqual(plan.url, "http://127.0.0.1:3000/public/index.html");
  assert.strictEqual(plan.command, "npm start");

  const canonical = resolvePreviewUrl(root, "http://localhost:3000/app.js", "http://127.0.0.1:3000");
  assert.strictEqual(canonical.ok, true);
  assert.strictEqual(canonical.url, "http://127.0.0.1:3000/");
  assert.strictEqual(canonical.canonicalizedFromAsset, "http://localhost:3000/app.js");

  if (process.platform !== "win32") {
    const socketRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-preview-socket-"));
    const socketPath = path.join(socketRoot, "--port");
    const socketServer = net.createServer();
    await new Promise((resolve, reject) => {
      socketServer.once("error", reject);
      socketServer.listen(socketPath, resolve);
    });
    assert.strictEqual(fs.lstatSync(socketPath).isSocket(), true);
    assert.strictEqual(recoverFlagSocket(socketRoot), true);
    assert.strictEqual(fs.existsSync(socketPath), false);
    await new Promise((resolve) => socketServer.close(resolve));
  }

  // Static preview creation remains available to the explicit process/session owner,
  // but browser.check itself never calls it.
  const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-static-session-"));
  fs.writeFileSync(path.join(staticRoot, "index.html"), "<title>Static</title><h1>Static</h1>");
  const staticPreview = await ensureStaticPreview(staticRoot, 0);
  const staticCommands = [];
  const staticMock = mockVscode(staticCommands);
  const staticResult = await createPreviewRunner(staticMock.vscode).check(staticRoot, `http://127.0.0.1:${staticPreview.port}/`);
  assert.strictEqual(staticResult.available, true);
  assert.strictEqual(staticMock.terminalStarts, 0);
  assert.deepStrictEqual(staticCommands.map((item) => item.name), [
    "codeme.hideStart",
    "simpleBrowser.show",
  ]);
  await new Promise((resolve) => staticPreview.server.close(resolve));

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
  const assetCommands = [];
  const assetMock = mockVscode(assetCommands);
  const assetResult = await createPreviewRunner(assetMock.vscode).check(assetRoot, assetsLive.url);
  assert.strictEqual(assetResult.available, true);
  assert.strictEqual(assetResult.assets.length, 2);
  assert.ok(assetResult.assets.every((item) => item.ok));
  assert.strictEqual(assetMock.terminalStarts, 0);
  assert.deepStrictEqual(assetCommands.map((item) => item.name), [
    "codeme.hideStart",
    "simpleBrowser.show",
  ]);
  await new Promise((resolve) => assetsLive.server.close(resolve));

  // HTTP 500 means a server answered. Verification must return that evidence and
  // must not attempt npm start or any hidden restart.
  const broken = await listen((_req, res) => {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end("<h1>Server error</h1>");
  });
  const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-http500-preview-"));
  fs.writeFileSync(path.join(brokenRoot, "package.json"), JSON.stringify({ scripts: { start: `node server.js` } }));
  fs.writeFileSync(path.join(brokenRoot, "server.js"), `server.listen(${broken.port});\n`);
  const brokenCommands = [];
  const brokenMock = mockVscode(brokenCommands);
  const brokenResult = await createPreviewRunner(brokenMock.vscode).check(brokenRoot, broken.url);
  assert.strictEqual(brokenResult.available, false);
  assert.strictEqual(brokenResult.code, "page_status");
  assert.strictEqual(brokenResult.statusCode, 500);
  assert.strictEqual(brokenMock.terminalStarts, 0);
  assert.deepStrictEqual(brokenCommands, []);
  await new Promise((resolve) => broken.server.close(resolve));

  // A connection failure is classified as not-running; it is still not started
  // by the read-only verifier.
  const downRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-down-preview-"));
  fs.writeFileSync(path.join(downRoot, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
  fs.writeFileSync(path.join(downRoot, "server.js"), "server.listen(6553);\n");
  const downCommands = [];
  const downMock = mockVscode(downCommands);
  const down = await createPreviewRunner(downMock.vscode).check(downRoot, "http://127.0.0.1:6553/");
  assert.strictEqual(down.available, false);
  assert.strictEqual(down.code, "preview_not_running");
  assert.strictEqual(downMock.terminalStarts, 0);
  assert.deepStrictEqual(downCommands, []);

  const refs = extractLocalAssets(
    '<link rel="stylesheet" href="styles.css"><script src="script.js"></script>',
    "http://127.0.0.1:3000/",
  );
  assert.deepStrictEqual(refs.map((item) => [item.kind, item.path]), [
    ["style", "styles.css"],
    ["script", "script.js"],
  ]);

  console.log("ok preview runner is verification-only");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
