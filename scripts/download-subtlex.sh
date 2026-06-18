#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW_DIR="$ROOT/data/raw"
ZIP_PATH="$RAW_DIR/SUBTLEX-CH.zip"
OUTPUT_PATH="$RAW_DIR/frequency.txt"
PLOS_URL="https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0010729.s002&type=supplementary"

mkdir -p "$RAW_DIR"

if [[ -f "$OUTPUT_PATH" ]]; then
  echo "Frequency list already present at $OUTPUT_PATH"
  exit 0
fi

echo "Downloading SUBTLEX-CH from PLOS ONE..."
curl -L -o "$ZIP_PATH" "$PLOS_URL"

echo "Extracting SUBTLEX-CH-WF (GBK → UTF-8)..."
unzip -p "$ZIP_PATH" SUBTLEX-CH-WF | iconv -f GBK -t UTF-8 > "$OUTPUT_PATH"

echo "Wrote $OUTPUT_PATH"
