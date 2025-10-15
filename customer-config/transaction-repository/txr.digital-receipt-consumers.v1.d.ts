/*
  JSON schema generated with:
  ```bash
  npx ts-json-schema-generator --no-top-ref \
    --id 'https://raw.githubusercontent.com/extenda/hiiretail-json-schema-registry/master/customer-config/transaction-repository/txr.digital-receipt-consumers.v1' \
    --path 'customer-config/transaction-repository/txr.digital-receipt-consumers.v1.d.ts' \
    | jq 'del(.definitions) + {"$schema":"https://json-schema.org/draft/2020-12/schema"}' \
    > customer-config/transaction-repository/txr.digital-receipt-consumers.v1.json
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
