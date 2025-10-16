// Generate json schema with: `dts-to-json-schema.sh`

export type DigitalReceiptConsumers = {
  externalEvents?: {},
  kivra?: {
    /** @default 'production' */
    environment?: 'production' | 'sandbox'
  },
}
