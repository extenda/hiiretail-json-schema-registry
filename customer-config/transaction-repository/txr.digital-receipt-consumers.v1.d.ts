/*
  JSON schema generated with:
  ```bash
  SCHEMA="customer-config/transaction-repository/txr.digital-receipt-consumers.v1"; \
  mkdir -p "$(dirname "$SCHEMA.json")"; \
  npx ts-json-schema-generator --no-top-ref \
    --id "https://raw.githubusercontent.com/extenda/hiiretail-json-schema-registry/master/$SCHEMA.json" \
    --path "$SCHEMA.d.ts" \
    | npx fx 'delete this.definitions, this.$schema="https://json-schema.org/draft/2020-12/schema", this' \
    > "$SCHEMA.json"
  ```
 */
export type DigitalReceiptConsumers = {
  onDemand?: {},
  externalEvents?: {},
  kivra?: {
    /** @default 'production' */
    environment?: 'production' | 'sandbox'
  },
}
