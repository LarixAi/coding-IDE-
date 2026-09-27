const assert = require("assert");
const http = require("http");
const {
  findBrowserExecutable,
  validateLocalUrl,
  clickExpression,
  observeExpression,
  collectBrowserError,
  createBrowserInteractionRunner,
} = require("../browser-interaction-runner");

async function listen(html) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    server,
    url: `http://127.0.0.1:${port}/`,
  };
}

async function main() {
  const local = validateLocalUrl("http://localhost:3000/");
  assert.strictEqual(local.ok, true);
  assert.strictEqual(local.url, "http://127.0.0.1:3000/");

  const blocked = validateLocalUrl("https://example.com/");
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, "invalid_url");

  const click = clickExpression("#actionBtn", "Click Me");
  assert.ok(click.includes("data-codeme-interaction-target"));
  assert.ok(click.includes("#actionBtn"));
  assert.ok(click.includes("Click Me"));

  const observe = observeExpression("It works!");
  assert.ok(observe.includes("It works!"));
  assert.ok(observe.includes("matched"));

  const errors = [];
  collectBrowserError({
    method: "Runtime.consoleAPICalled",
    params: {
      type: "error",
      args: [{ value: "broken click" }],
    },
  }, errors);
  assert.deepStrictEqual(errors, ["broken click"]);

  const executable = findBrowserExecutable();
  if (!executable || typeof WebSocket !== "function") {
    console.log("skip browser interaction integration — no supported Chromium/WebSocket runtime");
    console.log("ok browser interaction runner");
    return;
  }

  const page = await listen([
    "<!doctype html>",
    "<html><body>",
    '<button id="actionBtn">Click Me</button>',
    "<script>",
    'document.getElementById("actionBtn").addEventListener("click", function () { this.textContent = "It works!"; });',
    "</script>",
    "</body></html>",
  ].join("\n"));

  try {
    const result = await createBrowserInteractionRunner().interact({
      url: page.url,
      action: "click",
      targetText: "Click Me",
      expectedText: "It works!",
    });
    assert.strictEqual(result.available, true, JSON.stringify(result));
    assert.strictEqual(result.beforeText, "Click Me");
    assert.strictEqual(result.afterText, "It works!");
    assert.strictEqual(result.matched, true);
    assert.deepStrictEqual(result.consoleErrors, []);
  } finally {
    await new Promise((resolve) => page.server.close(resolve));
  }

  console.log("ok browser interaction runner");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
