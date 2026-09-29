const assert = require("assert");
const http = require("http");
const {
  findBrowserExecutable,
  validateLocalUrl,
  clickExpression,
  observeExpression,
  fillExpression,
  textObservationExpression,
  prepareInteractionSteps,
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


  const fill = fillExpression("#guestName", "Larone");
  assert.ok(fill.includes("#guestName"));
  assert.ok(fill.includes("Larone"));

  const assertText = textObservationExpression("#confirmation", "Booking confirmed");
  assert.ok(assertText.includes("#confirmation"));
  assert.ok(assertText.includes("Booking confirmed"));

  const observeStep = prepareInteractionSteps({
    action: "observe",
    selector: "h1",
    expectedText: "CodeMe Test Heading",
  });
  assert.strictEqual(observeStep.ok, true);
  assert.deepStrictEqual(observeStep.steps, [{
    action: "observe",
    selector: "h1",
    expectedText: "CodeMe Test Heading",
  }]);

  const sequence = prepareInteractionSteps({
    action: "sequence",
    steps: [
      { action: "fill", selector: "#guestName", value: "Larone" },
      { action: "click", selector: "#submitBtn" },
      { action: "assertText", expectedText: "Booking confirmed" },
    ],
  });
  assert.strictEqual(sequence.ok, true);
  assert.strictEqual(sequence.steps.length, 3);

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
    '<form id="bookingForm">',
    '<input id="guestName" name="guestName">',
    '<input id="guestEmail" name="guestEmail">',
    '<button id="submitBtn" type="submit">Book</button>',
    '</form>',
    '<p id="confirmation" hidden></p>',
    "<script>",
    'document.getElementById("actionBtn").addEventListener("click", function () { this.textContent = "It works!"; });',
    'document.getElementById("bookingForm").addEventListener("submit", function (event) { event.preventDefault(); const name = document.getElementById("guestName").value; const email = document.getElementById("guestEmail").value; const node = document.getElementById("confirmation"); node.hidden = false; node.textContent = "Booking confirmed for " + name + " (" + email + ")"; });',
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

    const form = await createBrowserInteractionRunner().interact({
      url: page.url,
      action: "sequence",
      steps: [
        { action: "fill", selector: "#guestName", value: "Larone" },
        { action: "fill", selector: "#guestEmail", value: "larone@example.com" },
        { action: "click", selector: "#submitBtn" },
        { action: "assertText", selector: "#confirmation", expectedText: "Booking confirmed for Larone" },
      ],
    });
    assert.strictEqual(form.available, true, JSON.stringify(form));
    assert.strictEqual(form.action, "sequence");
    assert.strictEqual(form.steps.length, 4);
    assert.strictEqual(form.steps[0].afterValue, "Larone");
    assert.strictEqual(form.steps[1].afterValue, "larone@example.com");
    assert.strictEqual(form.steps[3].matched, true);
    assert.ok(form.steps[3].afterText.includes("Booking confirmed for Larone"));
    assert.deepStrictEqual(form.consoleErrors, []);

    const observed = await createBrowserInteractionRunner().interact({
      url: page.url,
      action: "observe",
      selector: "body",
      expectedText: "Click Me",
    });
    assert.strictEqual(observed.available, true, JSON.stringify(observed));
    assert.strictEqual(observed.matched, true);
    assert.ok(observed.afterText.includes("Click Me"));
    assert.deepStrictEqual(observed.consoleErrors, []);
    assert.deepStrictEqual(observed.pageErrors, []);
    assert.deepStrictEqual(observed.failedRequests, []);
    assert.deepStrictEqual(observed.httpErrors, []);
  } finally {
    await new Promise((resolve) => page.server.close(resolve));
  }

  console.log("ok browser interaction runner");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
