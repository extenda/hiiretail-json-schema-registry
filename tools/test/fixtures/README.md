# Captured messages

These are real `grc.public.event.goods-received.v1` message bodies, pulled off
the topic in `hiiretail-goods-received-processor`'s component test suite
(`test/api`, Spanner + Pub/Sub emulators) and written out verbatim. They are not
hand-written samples: every field, including the ones HII-13841 is about, is
whatever `submit-delivery.command.ts` actually published.

| file | how it is produced |
| --- | --- |
| `priced-line.json` | a delivery line with `unit_price` and `currency_code` set |
| `unpriced-line.json` | a manually created line with both columns NULL, which publishes `unitPrice: null` and `currencyCode: null` |

Both columns are nullable on purpose - Liquibase changesets
`extenda:make_unit_price_nullable` and `extenda:make_currency_code_nullable`.
Null means *unpriced*, not zero, so the schema has to accept it rather than the
publisher coercing it away.

Re-capture them by submitting a delivery through the processor's component tests
and dumping `message.data`. Note that `SpannerWrapper.insertDeliveryLines`
coerces `unit_price` to `Float(0)`, so the unpriced case has to be inserted
through the raw `delivery_lines` table.
