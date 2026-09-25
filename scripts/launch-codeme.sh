#!/bin/sh
# Launch the pinned Code - OSS build with the minimal CodeMe shell.
# Explorer, editor, and terminal stay the native Code - OSS tools.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
user_data="$root/.tools/codeme-user-data"

if [ ! -x "$node_bin/node" ]; then
	echo "Node 24.18.0 is missing at $node_bin. Install it before launching." >&2
	exit 1
fi
if [ ! -x "$root/code-oss/.build/electron/Code - OSS.app/Contents/MacOS/Code - OSS" ]; then
	echo "Code - OSS is not built. From code-oss/, run npm install and node build/lib/preLaunch.ts." >&2
	exit 1
fi

mkdir -p "$user_data"
export PATH="$node_bin:$PATH"
export VSCODE_SKIP_PRELAUNCH=1

cd "$root/code-oss"
exec ./scripts/code.sh \
	--extensionDevelopmentPath="$root/extensions/codeme-shell" \
	--user-data-dir="$user_data" \
	"$@"
