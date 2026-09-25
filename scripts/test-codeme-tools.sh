#!/bin/sh
# Gate 4: contract checks, then the same tools inside Code - OSS on a real Git workspace.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
app="$root/code-oss/.build/electron/Code - OSS.app/Contents/MacOS/Code - OSS"

if [ ! -x "$node_bin/node" ]; then
	echo "Node 24.18.0 is missing at $node_bin" >&2
	exit 1
fi
if [ ! -x "$app" ]; then
	echo "Code - OSS is not built at $app" >&2
	exit 1
fi

export PATH="$node_bin:$PATH"
node "$root/packages/agent-tools/test/contract.test.js"

workspace="$root/.tools/codeme-tool-workspace"
user_data="$root/.tools/codeme-tool-user-data"
rm -rf "$workspace" "$user_data"
mkdir -p "$workspace" "$user_data"

git init -b main "$workspace" >/dev/null
git -C "$workspace" config user.email test@example.com
git -C "$workspace" config user.name test
printf 'base\n' > "$workspace/README.md"
git -C "$workspace" add README.md
git -C "$workspace" commit -m init >/dev/null

export NODE_ENV=development
export VSCODE_DEV=1
export VSCODE_CLI=1
export ELECTRON_ENABLE_LOGGING=1
export ELECTRON_ENABLE_STACK_DUMPING=1
cd "$root/code-oss"
# The first "." is the Electron app root. The workspace path is the folder Code - OSS opens.
"$app" . "$workspace" \
	--extensionDevelopmentPath="$root/extensions/codeme-shell" \
	--extensionTestsPath="$root/extensions/codeme-shell/test/index.js" \
	--disable-telemetry \
	--disable-updates \
	--skip-welcome \
	--skip-release-notes \
	--disable-workspace-trust \
	--use-inmemory-secretstorage \
	--user-data-dir="$user_data"
