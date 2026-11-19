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

// The committed file declares its identifier as `id`, which strict Ajv rejects.
const { id, ...storeFulfillmentsBody } = schemaAt(
  'external-events/cor/cor.public.event.store-fulfillments-updates.v2.json',
);
const storeFulfillmentsUpdates = { $id: id, ...storeFulfillmentsBody };

describe('cor.public.event.store-fulfillments-updates.v2', () => {
  const validate = compile(storeFulfillmentsUpdates);

  const fulfillment = {
    fulfillmentId: 'ff-1',
    fulfillmentMethod: 'HOME_DELIVERY_FROM_STORE',
    status: { status: 'CREATED' },
    lineItems: [],
  };

  const message = (extra = {}) => ({
    fulfillments: [{ ...fulfillment, ...extra }],
  });

  test('a fulfillment with isTmsShipment true validates', () => {
    assert.equal(
      validate(message({ isTmsShipment: true })),
      true,
      JSON.stringify(validate.errors),
    );
  });

  test('a fulfillment with isTmsShipment false validates', () => {
    assert.equal(
      validate(message({ isTmsShipment: false })),
      true,
      JSON.stringify(validate.errors),
    );
  });

  // Messages published before HII-14849 carry no key.
  test('a fulfillment without isTmsShipment validates', () => {
    assert.equal(validate(message()), true, JSON.stringify(validate.errors));
  });

  // additionalProperties: false rejects any unknown key, so rejection alone
  // proves nothing: the error must be a type error on isTmsShipment itself.
  test('a string isTmsShipment is rejected as a type error on the property', () => {
    assert.equal(validate(message({ isTmsShipment: 'true' })), false);
    assert.ok(
      validate.errors.some(
        (e) =>
          e.keyword === 'type' &&
          e.instancePath.endsWith('/isTmsShipment') &&
          e.params.type === 'boolean',
      ),
      JSON.stringify(validate.errors),
    );
  });
});
