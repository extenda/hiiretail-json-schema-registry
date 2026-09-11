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

const stc = schemaAt(
  'external-events/stc/stc.public.event.stock-count-completed.v1.json',
);
const scr = schemaAt(
  'external-events/scr/scr.public.event.stock-corrections.v1.schema.json',
);

describe('stc.public.event.stock-count-completed.v1', () => {
  // The published copy carried `"$ref": "StockCountItem.schema.json"` while no
  // such file exists anywhere under external-events/. An external subscriber
  // could not resolve the schema at all - it failed before validating anything,
  // which is worse than the missing properties it was reported for.
  test('resolves as a self-contained document', () => {
    assert.doesNotThrow(() => compile(stc));
  });

  test('declares the counted dates, and declares them nullable', () => {
    // The publisher types both as `string | null`
    // (hiiretail-stock-count-processor PublicStockCountType:15-16), and the
    // values come from counted_datetime, a nullable TIMESTAMP. Adding them as
    // plain "string" would have reinstated the same defect in a new form.
    for (const field of ['firstCountedDateTime', 'lastCountedDateTime']) {
      assert.deepEqual(stc.properties[field].type, ['null', 'string'], field);
    }
  });

  test('declares the three amounts and the comment as nullable', () => {
    assert.deepEqual(stc.properties.comment.type, ['null', 'string']);
    assert.deepEqual(stc.properties.expectedCostAmount.type, ['number', 'null']);
    assert.deepEqual(stc.properties.actualCostAmount.type, ['number', 'null']);
  });

  test('per-entity counted dates are nullable too, not only the root ones', () => {
    // StockCountData is reached from both StockCountItem and
    // StockCountLocation, so item and location level share this declaration.
    for (const field of ['firstCountedDateTime', 'lastCountedDateTime']) {
      assert.deepEqual(stc.$defs.StockCountData.properties[field].type, [
        'null',
        'string',
      ]);
    }
  });

  // Shaped from PublicStockCountType rather than captured off the topic - the
  // stock-count emulators are not wired into this repo. Every field below is
  // taken from that interface, and the null-carrying variant is the shape a
  // count with an uncounted entity produces.
  const message = ({ dates = null, comment = null } = {}) => ({
    tenantId: 'tenantId',
    businessUnitId: 'EU002',
    stockCountId: 'sc-1',
    type: 'FULL',
    submittedAt: '2026-09-11T09:30:47Z',
    submittedBy: 'userId',
    comment,
    numberOfItemsCounted: 1,
    numberOfItemsNotCounted: 0,
    expectedCostAmount: null,
    actualCostAmount: null,
    firstCountedDateTime: dates,
    lastCountedDateTime: dates,
    messageNumber: 1,
    lastMessageNumber: 1,
    items: [
      {
        itemId: 'item-1',
        itemIdentifier: null,
        itemName: null,
        expectedQuantity: null,
        expectedCostAmount: null,
        actualQuantity: 1,
        actualCostAmount: null,
        firstCountedDateTime: dates,
        lastCountedDateTime: dates,
        locations: [],
      },
    ],
  });

  test('a message whose entity was never counted validates', () => {
    const validate = compile(stc);
    const valid = validate(message());

    assert.ok(
      valid,
      (validate.errors ?? [])
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('; '),
    );
  });

  test('a message carrying counted dates validates', () => {
    const validate = compile(stc);
    const valid = validate(
      message({ dates: '2026-09-11T09:30:47Z', comment: 'counted' }),
    );

    assert.ok(
      valid,
      (validate.errors ?? [])
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('; '),
    );
  });
});

describe('scr.public.event.stock-corrections.v1', () => {
  const message = () => ({
    tenantId: 'tenantId',
    businessUnitId: 'EU002',
    transactionDateTime: '2026-09-11T09:30:47Z',
    itemId: 'item-1',
    quantity: 1,
    reasonCode: 'DAMAGED',
    userId: 'userId',
    stockCorrectionId: 'correction-1',
  });

  // The root is additionalProperties: false and stockCorrectionId was missing
  // from the published copy while the contract declares it in properties and
  // required - so a validating subscriber rejected every message.
  test('declares stockCorrectionId, in properties and required', () => {
    assert.equal(scr.properties.stockCorrectionId.type, 'string');
    assert.ok(scr.required.includes('stockCorrectionId'));
  });

  test('a message carrying stockCorrectionId validates', () => {
    const validate = compile(scr);
    const valid = validate(message());

    assert.ok(
      valid,
      (validate.errors ?? [])
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('; '),
    );
  });

  test('a message without stockCorrectionId is rejected', () => {
    const { stockCorrectionId, ...without } = message();

    assert.equal(compile(scr)(without), false);
  });
});
