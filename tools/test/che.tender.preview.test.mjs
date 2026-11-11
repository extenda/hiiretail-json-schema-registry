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

describe('che.tender.preview default tender rules', () => {
  const kinds = schema.items.properties.type.oneOf.map(
    (branch) => branch.properties.kind.const,
  );
  const kindOf = (condition) =>
    condition?.allOf?.[0]?.properties?.type?.properties?.kind?.const;

  // The rules are written out per type, so a new type without its two rules
  // would silently get no default tender validation.
  const isYes = (condition) =>
    condition?.allOf?.some(
      (part) =>
        part.properties?.behavior?.properties?.defaultTender?.const === 'YES',
    );

  test('every type has its "at most one Yes" rule', () => {
    const covered = schema.allOf
      .filter((rule) => rule.maxContains === 1 && isYes(rule.contains))
      .map((rule) => kindOf(rule.contains));
    assert.deepEqual(covered.toSorted(), kinds.toSorted());
  });

  // With several foreign currencies the till always asks the cashier, so none
  // has to be Yes.
  test('every type except foreign currency has its "needs one Yes" rule', () => {
    const covered = schema.allOf
      .filter((rule) => rule.if?.minContains === 2)
      .map((rule) => kindOf(rule.if.contains));
    assert.deepEqual(
      covered.toSorted(),
      kinds.filter((kind) => kind !== 'foreignCurrency').toSorted(),
    );
  });

  // Cash changers are left out of the count, and hardware exists only on cash,
  // so the other types' rules need no cash changer clause.
  test('a cash changer does not count against the drawer cash tender', () => {
    const changer = tender('CCM', { kind: 'cash', hardware: 'CASH_CHANGER_MACHINE' });
    assert.deepEqual(errorPaths([cash, changer]), []);
  });

  test('only cash declares hardware', () => {
    const withHardware = schema.items.properties.type.oneOf
      .filter((branch) => 'hardware' in branch.properties)
      .map((branch) => branch.properties.kind.const);
    assert.deepEqual(withHardware, ['cash']);
  });

  test('two automatic card tenders are refused, one set to Yes is accepted', () => {
    const card = (id, behavior) =>
      tender(id, { kind: 'creditDebit', terminal: 'STANDALONE' }, { behavior });
    assert.notDeepEqual(errorPaths([cash, card('A'), card('B')]), []);
    assert.deepEqual(
      errorPaths([cash, card('A', { defaultTender: 'YES' }), card('B')]),
      [],
    );
  });
});

describe('che.tender.preview pay remaining amount', () => {
  // With auto tender on, the Checkout Engine accepts only the exact converted
  // amount on foreign currency, so the customer could get no change.
  test('is not offered on foreign currency', () => {
    assert.ok(
      !schema.$defs.kindPayRemaining.properties.type.properties.kind.enum.includes(
        'foreignCurrency',
      ),
    );
  });
});
