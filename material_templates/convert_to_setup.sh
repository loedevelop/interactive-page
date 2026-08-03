#!/usr/bin/env bash
# 舊格式(4分頁) → 新格式(合併 _Setup 分頁) 轉換包裝：自動建 venv + 執行 convert_to_setup.py
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements-publish.txt
fi

if [[ ! -x .venv/bin/python ]]; then
  echo "venv 異常，請刪除 material_templates/.venv 後重跑" >&2
  exit 1
fi

exec .venv/bin/python convert_to_setup.py "$@"
