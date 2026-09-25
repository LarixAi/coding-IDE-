#!/bin/sh
# Gate 8: n8n capability foundation. Native coding tests stay in the run.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
export PATH="$node_bin:$PATH"

node "$root/packages/n8n-capability/build-workflows.js"
node "$root/packages/n8n-capability/test/foundation.test.js"
node "$root/packages/n8n-capability/test/capabilities.test.js"
node "$root/extensions/codeme-shell/test/panel.test.js"
node "$root/packages/n8n-capability/live-capabilities.js"
node "$root/packages/coding-qualify/test/policy.test.js"
node "$root/packages/feature-qualify/test/requirements.test.js"
node "$root/packages/n8n-capability/live.js"
