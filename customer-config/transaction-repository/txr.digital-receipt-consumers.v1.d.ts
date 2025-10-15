/*
  JSON schema generated with:
  ```bash
  SCHEMA="customer-config/transaction-repository/txr.digital-receipt-consumers.v1"; \
  npx ts-json-schema-generator --no-top-ref --path "$SCHEMA.d.ts" \
    --id "https://raw.githubusercontent.com/extenda/hiiretail-json-schema-registry/master/$SCHEMA.json" \
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
