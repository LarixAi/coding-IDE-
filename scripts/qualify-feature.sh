#!/bin/sh
# Gate 7: multi-file feature qualification on a disposable fixture.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
export PATH="$node_bin:$PATH"

node "$root/packages/feature-qualify/test/requirements.test.js"
node "$root/packages/coding-qualify/test/policy.test.js"
node "$root/packages/feature-qualify/run.js"
