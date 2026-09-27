#!/bin/sh
# Gate 5: connect to local Qwen and run the read-only qualification.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
export PATH="$node_bin:$PATH"

node "$root/packages/agent-tools/test/contract.test.js"
node "$root/packages/qwen-qualify/run.js"
