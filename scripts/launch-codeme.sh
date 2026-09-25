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

# The Code - OSS pin keeps the upstream product name. Swap the dock icon
# in the built app so Finder and the Dock show the CodeMe mark.
app_bundle="$root/code-oss/.build/electron/Code - OSS.app"
icon_src="$root/branding/macos/CodeMe.icns"
icon_dest="$app_bundle/Contents/Resources/Code - OSS.icns"
if [ -f "$icon_src" ] && [ -f "$icon_dest" ] && ! cmp -s "$icon_src" "$icon_dest"; then
	cp "$icon_src" "$icon_dest"
	touch "$app_bundle"
fi

cd "$root/code-oss"
exec ./scripts/code.sh \
	--extensionDevelopmentPath="$root/extensions/codeme-shell" \
	--user-data-dir="$user_data" \
	"$@"
