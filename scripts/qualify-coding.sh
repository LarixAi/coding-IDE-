#!/bin/sh
# Gate 6: controlled coding qualification. The fixture is disposable.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
export PATH="$node_bin:$PATH"

node "$root/packages/coding-qualify/test/policy.test.js"
node "$root/packages/coding-qualify/run.js"
