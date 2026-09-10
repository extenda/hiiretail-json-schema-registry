#!/usr/bin/env bash
# This script generates a TypeScript definition file (.d.ts) from a JSON Schema.
# Usage: ./json2dts.sh <alias|path/to/file.json>

set -euo pipefail

# name -> path aliases (paths relative to repo root)
declare -A ALIASES=(
  [checkout-app]="customer-config/checkout-app/cha.settings.v1.json"
  [checkout-app-preview]="customer-config/checkout-app/cha.settings.preview.json"
)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <alias|path/to/file.json>" >&2
  echo "Aliases:" >&2
  for name in "${!ALIASES[@]}"; do
    echo "  $name -> ${ALIASES[$name]}" >&2
  done
  exit 1
fi

ARG="$1"
if [[ -v ALIASES[$ARG] ]]; then
  INPUT="$SCRIPT_DIR/${ALIASES[$ARG]}"
elif [[ "$ARG" = /* ]]; then
  INPUT="$ARG"
else
  INPUT="$SCRIPT_DIR/$ARG"
fi

if [[ ! -f "$INPUT" ]]; then
  echo "Error (file not found): $INPUT" >&2
  echo "Usage: $0 <alias|path/to/file.json>" >&2
  exit 1
fi

OUTPUT="$(dirname "$INPUT")/$(basename "$INPUT" .json).d.ts"

npx -y --package=json-schema-to-typescript@15.0.4 json2ts \
  --additionalProperties=false \
  --input "$INPUT" \
  --output "$OUTPUT"

echo "Generated definitions: $OUTPUT"
