#!/bin/sh
# Durable AgentRun checks. Write, terminal, and test tools stay blocked.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
export PATH="$node_bin:$PATH"

node "$root/packages/agent-runtime/test/orchestration.test.js"
