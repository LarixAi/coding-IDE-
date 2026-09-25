const assert = require("assert");
const { createApp } = require("../src/app");

function post(app, body) {
  return app.handle({ method: "POST", path: "/users", body });
}

const app = createApp();

const missingName = post(app, { email: "ada@example.com" });
assert.strictEqual(missingName.status, 400);
assert.ok(missingName.body && missingName.body.error);

const blankName = post(app, { name: "  ", email: "ada@example.com" });
assert.strictEqual(blankName.status, 400);

const badEmail = post(app, { name: "Ada", email: "not-an-email" });
assert.strictEqual(badEmail.status, 400);
assert.ok(badEmail.body && badEmail.body.error);

const created = post(app, { name: "Ada", email: "ada@example.com" });
assert.strictEqual(created.status, 201);
assert.strictEqual(app.users.findByEmail("ada@example.com").name, "Ada");

const duplicate = post(app, { name: "Ada", email: "ada@example.com" });
assert.strictEqual(duplicate.status, 409);
assert.ok(duplicate.body && duplicate.body.error);
assert.strictEqual(app.users.list().length, 1);
