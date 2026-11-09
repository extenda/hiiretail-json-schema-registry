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

const schema = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, 'customer-config/checkout-config/che.tender.preview.json'),
    'utf8',
  ),
);

// The CCC API validates with Ajv 2020-12, strict mode off.
const validate = addFormats(
  new Ajv2020({ strict: false, allErrors: true }),
).compile(schema);

const tender = (id, type, extra = {}) => ({ id, name: id, type, ...extra });
const cash = tender('CASH', { kind: 'cash' });
const lockAndBlock = { behavior: { lockTransaction: true, blockCancel: true } };

const errorPaths = (list) => {
  validate(list);
  return (validate.errors ?? []).map((e) => e.instancePath);
};

describe('che.tender.preview lock and block cancelling', () => {
  // Together they leave a sale stuck: no items, no suspend, no void of the
  // tender line and no cancel, so the cashier can only pay it in full.
  for (const [name, type, extra] of [
    ['voucher', { kind: 'voucher' }, {}],
    ['manufacturer coupon', { kind: 'manufacturerCoupon' }, {}],
    ['organization charge without credit check', { kind: 'organizationCharge' }, {}],
    ['disabled voucher', { kind: 'voucher' }, { disabled: true }],
  ]) {
    test(`refused on a ${name}`, () => {
      const list = [cash, tender('T', type, { ...extra, ...lockAndBlock })];
      assert.ok(errorPaths(list).includes('/1/behavior/blockCancel'));
    });
  }

  // Block cancelling is ignored on these types, so the combination is harmless.
  for (const [name, type, extra] of [
    ['foreign currency', { kind: 'foreignCurrency' }, { currency: 'EUR' }],
    ['card', { kind: 'creditDebit', terminal: 'STANDALONE' }, {}],
    ['credit-checked organization charge', { kind: 'organizationCharge', creditCheck: true }, {}],
  ]) {
    test(`accepted on ${name}`, () => {
      const list = [cash, tender('T', type, { ...extra, ...lockAndBlock })];
      assert.deepEqual(errorPaths(list), []);
    });
  }

  test('each setting alone is accepted on a voucher', () => {
    for (const behavior of [{ lockTransaction: true }, { blockCancel: true }]) {
      const list = [cash, tender('VO', { kind: 'voucher' }, { behavior })];
      assert.deepEqual(errorPaths(list), [], JSON.stringify(behavior));
    }
  });

  test('applies to the same types as $defs.kindCancelBlockable', () => {
    const rule = schema.items.allOf.find((r) =>
      r.$comment?.startsWith('Lock and block cancelling'),
    );
    assert.deepEqual(
      rule.if.allOf[0].properties.type.properties.kind.enum,
      schema.$defs.kindCancelBlockable.properties.type.properties.kind.enum,
    );
  });
});
