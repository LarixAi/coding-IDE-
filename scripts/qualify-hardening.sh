#!/bin/sh
# Gate 11: autonomous agent hardening. Scripted benchmarks, no live model required.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
export PATH="$node_bin:$PATH"

node "$root/packages/agent-runtime/test/hardening.test.js"
node "$root/packages/agent-runtime/test/mode-contract.test.js"
node "$root/packages/agent-runtime/test/stagnation.test.js"
node "$root/packages/coding-qualify/test/policy.test.js"
node "$root/packages/feature-qualify/test/requirements.test.js"
node "$root/packages/n8n-capability/test/foundation.test.js"
node "$root/packages/n8n-capability/test/registry.test.js"
node "$root/packages/agent-runtime/test/orchestration.test.js"
