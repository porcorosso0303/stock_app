#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:-release/win-unpacked}"
target_dir="${2:-/mnt/c/Users/kazum/Desktop/A股调研助手-最新版本/win-unpacked}"

mkdir -p "$target_dir"
rsync -a --delete --exclude=/user_data/ "$source_dir/" "$target_dir/"
