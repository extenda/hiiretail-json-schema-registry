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

  // A valid tender of each type; the foreign currency tenders A and B get distinct currencies.
  const currencyOf = { A: 'EUR', B: 'NOK' };
  const typeOf = {
    creditDebit: { terminal: 'STANDALONE' },
    mobile: { integration: 'INTEGRATED', provider: 'SWISH' },
  };
  const extraOf = {
    foreignCurrency: (id) => ({ currency: currencyOf[id] }),
    foodStamp: () => ({ restrictionRuleId: 'FOOD' }),
    wicCheck: () => ({ restrictionRuleId: 'WIC' }),
  };
  const ofKind = (kind, id, behavior, extra = {}) =>
    tender(
      id,
      { kind, ...typeOf[kind] },
      { ...extraOf[kind]?.(id), ...extra, ...(behavior && { behavior }) },
    );
  // Every list needs its default cash tender; for cash, the tenders under test are it.
  const listOf = (kind, ...tenders) =>
    kind === 'cash' ? tenders : [cash, ...tenders];

  // The default tender rules compare tenders, so their errors are on the list.
  const refusedOnTheList = (list) => {
    validate(list);
    return (validate.errors ?? []).some(
      (e) => e.instancePath === '' && e.keyword === 'contains',
    );
  };

  // The rules are written out per type, so each type is tested on its own.
  for (const kind of kinds) {
    describe(kind, () => {
      test('one set to Yes next to an Automatic one is accepted', () => {
        const list = listOf(kind, ofKind(kind, 'A', { defaultTender: 'YES' }), ofKind(kind, 'B'));
        assert.deepEqual(errorPaths(list), []);
      });

      test('two set to Yes are refused', () => {
        const yes = { defaultTender: 'YES' };
        assert.ok(refusedOnTheList(listOf(kind, ofKind(kind, 'A', yes), ofKind(kind, 'B', yes))));
      });

      test('a disabled or No tender does not count', () => {
        for (const [first, second] of [
          [undefined, ofKind(kind, 'B', undefined, { disabled: true })],
          [undefined, ofKind(kind, 'B', { defaultTender: 'NO' })],
          [{ defaultTender: 'YES' }, ofKind(kind, 'B', { defaultTender: 'YES' }, { disabled: true })],
        ]) {
          const list = listOf(kind, ofKind(kind, 'A', first), second);
          assert.deepEqual(errorPaths(list), [], JSON.stringify(second));
        }
      });

      // A Yes that is disabled, or on another type, does not settle the default.
      if (kind !== 'foreignCurrency') {
        test('two Automatic ones next to a disabled Yes are refused', () => {
          const disabledYes = ofKind(kind, 'C', { defaultTender: 'YES' }, { disabled: true });
          assert.ok(refusedOnTheList(listOf(kind, ofKind(kind, 'A'), ofKind(kind, 'B'), disabledYes)));
        });

        test('two Automatic ones next to a Yes of another type are refused', () => {
          const other = kind === 'voucher' ? 'giftCertificate' : 'voucher';
          const otherYes = ofKind(other, 'C', { defaultTender: 'YES' });
          assert.ok(refusedOnTheList(listOf(kind, ofKind(kind, 'A'), ofKind(kind, 'B'), otherYes)));
        });
      }

      // With several foreign currencies the till always asks the cashier, so
      // none has to be Yes.
      test(
        kind === 'foreignCurrency'
          ? 'two Automatic ones are accepted'
          : 'two Automatic ones are refused',
        () => {
          const list = listOf(kind, ofKind(kind, 'A'), ofKind(kind, 'B'));
          if (kind === 'foreignCurrency') {
            assert.deepEqual(errorPaths(list), []);
          } else {
            assert.ok(refusedOnTheList(list));
          }
        },
      );
    });
  }

  // Cash changers are left out of the count, and hardware exists only on cash,
  // so the other types' rules need no cash changer clause.
  test('a cash changer does not count against the drawer cash tender', () => {
    const changer = tender('CCM', { kind: 'cash', hardware: 'CASH_CHANGER_MACHINE' });
    assert.deepEqual(errorPaths([cash, changer]), []);
  });

  describe('cash changer', () => {
    const changer = (behavior, id = 'CCM') =>
      tender(id, { kind: 'cash', hardware: 'CASH_CHANGER_MACHINE' }, behavior && { behavior });

    test('set to Yes is refused', () => {
      assert.ok(errorPaths([cash, changer({ defaultTender: 'YES' })]).includes('/1/behavior/defaultTender'));
    });

    test('two enabled ones are refused', () => {
      assert.ok(refusedOnTheList([cash, changer(undefined, 'C1'), changer({ defaultTender: 'NO' }, 'C2')]));
    });

    test('one without a cash drawer tender is refused', () => {
      assert.ok(refusedOnTheList([changer()]));
    });
  });

  test('only cash declares hardware', () => {
    const withHardware = schema.items.properties.type.oneOf
      .filter((branch) => 'hardware' in branch.properties)
      .map((branch) => branch.properties.kind.const);
    assert.deepEqual(withHardware, ['cash']);
  });
});

describe('che.tender.preview pay remaining amount', () => {
  const offered = schema.$defs.kindPayRemaining.properties.type.properties.kind.enum;
  const { description } = schema.items.properties.behavior.properties.payRemainingAmount;
  const ignoredSentence = description.slice(description.indexOf('Ignored for'));

  // With auto tender on, the Checkout Engine accepts only the exact converted
  // amount on foreign currency, so the customer could get no change.
  test('is not offered on foreign currency', () => {
    assert.ok(!offered.includes('foreignCurrency'));
  });

  // The help text lists by hand the types that do not offer it. Each pattern
  // matches its type's name only, not a longer name that contains it.
  test('the help text names exactly the types that do not offer it', () => {
    const nameOf = {
      cash: /(?<!currency )\bcash\b(?! changer)/,
      foreignCurrency: /\bforeign currency\b/,
      creditDebit: /(?<!gift )\bcards?\b/,
      mobile: /\bmobile\b/,
      electronicGiftCard: /\belectronic gift cards?\b/,
      giftCertificate: /\bgift certificates?\b/,
      voucher: /\bvouchers?\b/,
      check: /(?<!WIC )\bchecks?\b/,
      coupon: /(?<!manufacturer )\bcoupons?\b/,
      manufacturerCoupon: /\bmanufacturer coupons?\b/,
      loyaltyRedemption: /\bloyalty points\b/,
      organizationCharge: /\borganization charge\b/,
      houseAccount: /\bhouse accounts?\b/,
      foodStamp: /\bfood stamps?\b/,
      wicCheck: /\bWIC\b/,
    };
    for (const kind of schema.items.properties.type.oneOf.map(
      (branch) => branch.properties.kind.const,
    )) {
      assert.equal(
        nameOf[kind].test(ignoredSentence),
        !offered.includes(kind),
        kind,
      );
    }
  });

  // Settings that do not apply are ignored, not rejected: the portal keeps
  // hidden values, so a tender saved before the field was hidden stays valid.
  test('a foreign currency tender saved with it on stays valid', () => {
    const euro = tender(
      'EUR',
      { kind: 'foreignCurrency' },
      { currency: 'EUR', behavior: { payRemainingAmount: true } },
    );
    assert.deepEqual(errorPaths([cash, euro]), []);
  });
});

describe('che.tender.preview rounding', () => {
  // The rule that requires a rounding unit repeats $defs.kindCashLike, which
  // the form uses to show the Rounding tab.
  test('applies to the same types as $defs.kindCashLike', () => {
    const rule = schema.items.allOf.find((r) =>
      r.$comment?.startsWith('A rounding method needs a rounding unit'),
    );
    assert.deepEqual(
      rule.if.allOf[0].properties.type.properties.kind.enum,
      schema.$defs.kindCashLike.properties.type.properties.kind.enum,
    );
  });
});
