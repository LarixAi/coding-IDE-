const assert = require("assert");
const { createApp } = require("../src/app");

const app = createApp();
const response = app.handle({ method: "GET", path: "/health" });
assert.strictEqual(response.status, 200);
assert.strictEqual(response.body.ok, true);
