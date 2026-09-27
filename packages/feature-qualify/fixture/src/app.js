const { health } = require("./routes/health");
const { createUserRepository } = require("./users/repository");

function createApp() {
  // One repository instance belongs to the app. Route handlers must use this object.
  const users = createUserRepository();

  function handle(request) {
    if (request.method === "GET" && request.path === "/health") return health();
    return { status: 404, body: { error: "not_found" } };
  }

  return { handle, users };
}

module.exports = { createApp };
