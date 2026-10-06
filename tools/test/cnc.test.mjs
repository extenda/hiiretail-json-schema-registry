import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

const REPO_ROOT = path.dirname(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);

const schemaAt = (rel) =>
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));

const compile = (schema) =>
  addFormats(new Ajv2020({ strict: true, allErrors: true })).compile(schema);

const orderCreated = schemaAt(
  'external-events/cnc/cnc.public.event.order-created.v1.json',
);
const statusChanged = schemaAt(
  'external-events/cnc/cnc.public.event.order-status-changed.v1.json',
);
const linePicked = schemaAt(
  'external-events/cnc/cnc.public.event.order-line-picked.v1.json',
);
const paymentInitiated = schemaAt(
  'external-events/cnc/cnc.public.event.order-payment-initiated.v1.json',
);
const lateChanges = schemaAt(
  'external-events/cnc/cnc.public.notification.order-late-changes-arrived.v1.json',
);

describe('cnc.public.event.order-created.v1', () => {
  const validate = compile(orderCreated);

  // The only Click and Collect topic whose property names are PascalCase
  // (click-and-collect-processor store-fulfillments.handler.ts). Modelling it
  // in camelCase like its sibling topics rejects every real message.
  test('declares PascalCase property names', () => {
    assert.deepEqual(orderCreated.required, [
      'FulfillmentId',
      'OrderId',
      'BusinessUnitId',
      'TenantId',
      'OrderCode',
      'ModifiedDatetime',
    ]);
  });

  // The producer spreads ProjectId, PickupDatetime and UrgentFromDatetime in
  // conditionally, so JSON.stringify omits the keys entirely rather than
  // sending null. Marking any of them required rejects a fulfillment that
  // carries no pickup time, which is the ordinary case for a project order.
  test('a message carrying none of the optional keys validates', () => {
    assert.equal(
      validate({
        FulfillmentId: 'ff-1',
        OrderId: 'co-1',
        BusinessUnitId: 'bu-1',
        TenantId: 'CIR7nQwtS0rA6t0S6ejd',
        OrderCode: 'ABC-001',
        ModifiedDatetime: '2026-10-06T09:15:00.000Z',
      }),
      true,
      JSON.stringify(validate.errors),
    );
  });

  test('a message carrying every optional key validates', () => {
    assert.equal(
      validate({
        FulfillmentId: 'ff-1',
        OrderId: 'co-1',
        BusinessUnitId: 'bu-1',
        TenantId: 'CIR7nQwtS0rA6t0S6ejd',
        OrderCode: 'ABC-001',
        ModifiedDatetime: '2026-10-06T09:15:00.000Z',
        ProjectId: 'proj-1',
        PickupDatetime: '2026-10-07T14:00:00.000Z',
        UrgentFromDatetime: '2026-10-07T10:00:00.000Z',
      }),
      true,
      JSON.stringify(validate.errors),
    );
  });

  test('a camelCase message is rejected', () => {
    assert.equal(
      validate({
        fulfillmentId: 'ff-1',
        orderId: 'co-1',
        businessUnitId: 'bu-1',
        tenantId: 'CIR7nQwtS0rA6t0S6ejd',
        orderCode: 'ABC-001',
        modifiedDatetime: '2026-10-06T09:15:00.000Z',
      }),
      false,
    );
  });
});

describe('cnc.public.event.order-status-changed.v1', () => {
  const validate = compile(statusChanged);

  const statusChange = {
    orderId: 'co-1',
    fulfillmentId: 'ff-1',
    tenantId: 'CIR7nQwtS0rA6t0S6ejd',
    businessUnitId: 'bu-1',
    previousStatus: 'CREATED',
    newStatus: 'PICKING',
    changedBy: 'user-1',
    changedAt: '2026-10-06T09:15:00.000Z',
    orderType: 'CUSTOMER_ORDER',
    orderLines: [
      {
        orderLineId: 'ol-1',
        itemId: 'item-1',
        pickedQuantity: 2,
        status: 'PICKED',
        substitutions: [],
      },
    ],
  };

  const pickupChange = {
    orderId: 'co-1',
    fulfillmentId: 'ff-1',
    tenantId: 'CIR7nQwtS0rA6t0S6ejd',
    businessUnitId: 'bu-1',
    pickupDatetime: '2026-10-07T14:00:00.000Z',
    urgentFromDatetime: '2026-10-07T10:00:00.000Z',
    modifiedDatetime: '2026-10-06T09:15:00.000Z',
  };

  test('resolves as a self-contained document', () => {
    assert.doesNotThrow(() => compile(statusChanged));
  });

  test('an ORDER_STATUS_CHANGED message validates', () => {
    assert.equal(validate(statusChange), true, JSON.stringify(validate.errors));
  });

  test('an ORDER_PICKUP_DATETIME_CHANGED message validates', () => {
    assert.equal(validate(pickupChange), true, JSON.stringify(validate.errors));
  });

  // The two shapes share four keys, so the branches are only unambiguous
  // because each requires fields the other forbids. A message carrying both
  // sets would match twice and oneOf must reject it - if it ever stops doing
  // so, the schema has silently become an anyOf and neither branch is enforced.
  test('a message merging both shapes is rejected', () => {
    assert.equal(validate({ ...statusChange, ...pickupChange }), false);
  });

  // HII-13771: changedAt was optional on the internal type, and the two
  // consumers picked opposite defaults for the undated case - one fail-closed,
  // one fail-open onto `now`, which applies a stale event as newest. It is the
  // ordering-guard source for this topic and is required on the wire.
  test('an ORDER_STATUS_CHANGED message without changedAt is rejected', () => {
    const { changedAt, ...withoutChangedAt } = statusChange;
    assert.equal(validate(withoutChangedAt), false);
  });

  // Both instants are null when the write cleared the pickup time, and the keys
  // are always sent. Typing them as plain string rejects every clear.
  test('a cleared pickup time validates as null', () => {
    assert.equal(
      validate({ ...pickupChange, pickupDatetime: null, urgentFromDatetime: null }),
      true,
      JSON.stringify(validate.errors),
    );
  });
});

describe('cnc.public.event.order-line-picked.v1', () => {
  const validate = compile(linePicked);

  const picked = {
    orderId: 'o-1',
    orderLineId: 'ol-1',
    tenantId: 'CIR7nQwtS0rA6t0S6ejd',
    businessUnitId: 'bu-1',
    pickedQty: 2,
    pickedBy: 'user-1',
    pickedAt: '2026-10-06T09:15:00.000Z',
  };

  test('a pick validates', () => {
    assert.equal(validate(picked), true, JSON.stringify(validate.errors));
  });

  // pickedQty 0 with isDone is the out-of-stock signal that sets the line
  // UNAVAILABLE, and it is published on this topic like any other pick. A
  // minimum of 1 or an exclusiveMinimum of 0 would reject it.
  test('an out-of-stock pick of quantity zero validates', () => {
    assert.equal(validate({ ...picked, pickedQty: 0 }), true, JSON.stringify(validate.errors));
  });

  // pickedBy is payload.userProfileId, undefined when the request carried no
  // user identity, so JSON.stringify omits the key.
  test('a pick without pickedBy validates', () => {
    const { pickedBy, ...anonymous } = picked;
    assert.equal(validate(anonymous), true, JSON.stringify(validate.errors));
  });

  test('a pick without pickedQty is rejected', () => {
    const { pickedQty, ...noQty } = picked;
    assert.equal(validate(noQty), false);
  });
});

describe('cnc.public.event.order-payment-initiated.v1', () => {
  const validate = compile(paymentInitiated);

  const payment = {
    orderId: 'co-1',
    fulfillmentId: 'ff-1',
    tenantId: 'CIR7nQwtS0rA6t0S6ejd',
    businessUnitId: 'bu-1',
    paymentType: 'CARD',
    reservedAmount: '129.95',
    additionalProperties: [],
    lines: [
      {
        orderLineId: 'ol-1',
        itemId: 'item-1',
        pickedQuantity: 2,
        additionalProperties: [],
        substitutions: null,
      },
    ],
  };

  test('a payment validates', () => {
    assert.equal(validate(payment), true, JSON.stringify(validate.errors));
  });

  // The producer sends null, not [], for a line with no substitutions
  // (payment-initiated.publisher.ts). Typing substitutions as a plain array
  // rejects every unsubstituted line, which is most of them.
  test('a line with substitutions null validates', () => {
    assert.equal(
      validate({ ...payment, lines: [{ ...payment.lines[0], substitutions: null }] }),
      true,
      JSON.stringify(validate.errors),
    );
  });

  test('a line carrying substitutions validates', () => {
    assert.equal(
      validate({
        ...payment,
        lines: [
          {
            ...payment.lines[0],
            substitutions: [{ itemId: 'item-2', pickedQuantity: 1, additionalProperties: [] }],
          },
        ],
      }),
      true,
      JSON.stringify(validate.errors),
    );
  });

  // picked_quantity is a nullable column and reaches the payload unchanged.
  test('a null pickedQuantity validates', () => {
    assert.equal(
      validate({ ...payment, lines: [{ ...payment.lines[0], pickedQuantity: null }] }),
      true,
      JSON.stringify(validate.errors),
    );
  });

  test('reservedAmount as a number is rejected', () => {
    assert.equal(validate({ ...payment, reservedAmount: 129.95 }), false);
  });
});

describe('cnc.public.notification.order-late-changes-arrived.v1', () => {
  const validate = compile(lateChanges);

  const notification = {
    internalOrderId: 'io-1',
    orderId: 'co-1',
    fulfillmentId: 'ff-1',
    tenantId: 'CIR7nQwtS0rA6t0S6ejd',
    businessUnitId: 'bu-1',
  };

  test('a notification validates', () => {
    assert.equal(validate(notification), true, JSON.stringify(validate.errors));
  });

  // orderId and fulfillmentId are the pair order-status-changed carries for the
  // same row, so a consumer can close this notification on the fulfillment's
  // terminal status (HII-14144). Dropping either breaks that join.
  test('a notification without fulfillmentId is rejected', () => {
    const { fulfillmentId, ...withoutFulfillment } = notification;
    assert.equal(validate(withoutFulfillment), false);
  });
});
