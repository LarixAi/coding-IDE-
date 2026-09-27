#!/bin/sh
# Gate 9: capability registry and name routing. Gate 6, 7, and 8 tests stay in the run.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
export PATH="$node_bin:$PATH"

node "$root/packages/n8n-capability/test/registry.test.js"
node "$root/packages/n8n-capability/test/capabilities.test.js"
node "$root/packages/n8n-capability/test/foundation.test.js"
node "$root/packages/coding-qualify/test/policy.test.js"
node "$root/packages/feature-qualify/test/requirements.test.js"
node "$root/packages/agent-runtime/test/orchestration.test.js"
node "$root/packages/n8n-capability/live.js"
node "$root/packages/n8n-capability/live-registry.js"
