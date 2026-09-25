#!/bin/sh
# Fetch the pinned Code - OSS tag into ./code-oss. Does not build or launch.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

pin=04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1
tag=1.139.1

if [ ! -e code-oss/.git ]; then
	git clone --depth 1 --branch "$tag" https://github.com/microsoft/vscode.git code-oss
fi

actual=$(git -C code-oss rev-parse HEAD)
if [ "$actual" != "$pin" ]; then
	echo "code-oss HEAD $actual does not match pinned $pin ($tag)" >&2
	exit 1
fi

echo "code-oss is $tag at $actual"
