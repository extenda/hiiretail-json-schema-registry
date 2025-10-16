// Generate json schema with: `dts-to-json-schema.sh`

export type DigitalReceiptTargets = {
  /** Default implementation, processed internally */
  default?: {},

  /** Sent to kivra.se */
  kivra?: {
    /** @default 'production' */
    environment?: 'production' | 'sandbox'
  },
}
