#!/usr/bin/env bash
# This script generates a JSON Schema from a TypeScript definition file (.d.ts).
# Usage: ./dts-to-json-schema.sh path/to/file.d.ts

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 path/to/file.d.ts" >&2
  exit 1
fi

INPUT="$1"
if [[ ! -f "$INPUT" ]]; then
  echo "Error (file not found): $INPUT" >&2
  echo "Usage: $0 path/to/file.d.ts" >&2
  exit 1
fi

OUTPUT="$(dirname "$INPUT")/$(basename "$INPUT" .d.ts).json"
ID="https://raw.githubusercontent.com/extenda/hiiretail-json-schema-registry/master/$OUTPUT"

npx -y ts-json-schema-generator \
  --no-top-ref \
  --path "$INPUT" \
  --id "$ID" \
| npx fx 'delete this.definitions, this.$schema="https://json-schema.org/draft/2020-12/schema", this' \
> "$OUTPUT"

echo "Generated schema: $OUTPUT"
