#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON="${ROOT}/.venv-semantic/bin/python"
SCRIPT="${ROOT}/scripts/prepare-semantic-knowledge.py"

if [[ ! -x "$PYTHON" ]]; then
  echo "Missing .venv-semantic. Run: npm run prepare:semantic:setup" >&2
  exit 1
fi

echo "Semantic prep: all words in data/words.json"
exec "$PYTHON" "$SCRIPT" --content-only --workers 24 --chunk-size 512 "$@"
