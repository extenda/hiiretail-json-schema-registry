#!/usr/bin/env bash
# This script generates a TypeScript definition file (.d.ts) from a JSON Schema.
# Usage: ./json-schema-to-dts.sh path/to/file.json

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 path/to/file.json" >&2
  exit 1
fi

INPUT="$1"
if [[ ! -f "$INPUT" ]]; then
  echo "Error (file not found): $INPUT" >&2
  echo "Usage: $0 path/to/file.json" >&2
  exit 1
fi

OUTPUT="$(dirname "$INPUT")/$(basename "$INPUT" .json).d.ts"

npx -y --package=json-schema-to-typescript@15.0.4 json2ts \
  --additionalProperties=false \
  --input "$INPUT" \
  --output "$OUTPUT"

echo "Generated definitions: $OUTPUT"
