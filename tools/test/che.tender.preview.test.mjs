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

// One valid tender of each type.
const kinds = schema.items.properties.type.oneOf.map((branch) => branch.properties.kind.const);
const typeOf = {
  creditDebit: { terminal: 'STANDALONE' },
  mobile: { integration: 'INTEGRATED', provider: 'SWISH' },
};
const currencyOf = { foreignCurrency: 'EUR' };
const ofKind = (kind, id, extra = {}) =>
  tender(id, { kind, ...typeOf[kind] }, { ...(currencyOf[kind] && { currency: currencyOf[kind] }), ...extra });

describe('che.tender.preview lock and block cancelling', () => {
  // Together they leave a sale stuck: no items, no suspend, no void of the
  // tender line and no cancel, so the cashier can only pay it in full.
  for (const kind of kinds) {
    test(`refused on ${kind}`, () => {
      const list = [cash, ofKind(kind, 'T', lockAndBlock)];
      assert.ok(errorPaths(list).includes('/1/behavior/blockCancel'));
    });
  }

  test('refused on a disabled tender', () => {
    const list = [cash, ofKind('voucher', 'T', { disabled: true, ...lockAndBlock })];
    assert.ok(errorPaths(list).includes('/1/behavior/blockCancel'));
  });

  test('each setting alone is accepted', () => {
    for (const behavior of [{ lockTransaction: true }, { blockCancel: true }]) {
      const list = [cash, ofKind('creditDebit', 'T', { behavior })];
      assert.deepEqual(errorPaths(list), [], JSON.stringify(behavior));
    }
  });
});

describe('che.tender.preview default tender rules', () => {
  // A valid tender of each type; the foreign currency tenders A and B get distinct currencies.
  const currencyOfId = { A: 'EUR', B: 'NOK' };
  const candidate = (kind, id, behavior, extra = {}) =>
    tender(
      id,
      { kind, ...typeOf[kind] },
      {
        ...(kind === 'foreignCurrency' && { currency: currencyOfId[id] }),
        ...extra,
        ...(behavior && { behavior }),
      },
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
        const list = listOf(kind, candidate(kind, 'A', { defaultTender: 'YES' }), candidate(kind, 'B'));
        assert.deepEqual(errorPaths(list), []);
      });

      test('two set to Yes are refused', () => {
        const yes = { defaultTender: 'YES' };
        assert.ok(refusedOnTheList(listOf(kind, candidate(kind, 'A', yes), candidate(kind, 'B', yes))));
      });

      test('a disabled or No tender does not count', () => {
        for (const [first, second] of [
          [undefined, candidate(kind, 'B', undefined, { disabled: true })],
          [undefined, candidate(kind, 'B', { defaultTender: 'NO' })],
          [{ defaultTender: 'YES' }, candidate(kind, 'B', { defaultTender: 'YES' }, { disabled: true })],
        ]) {
          const list = listOf(kind, candidate(kind, 'A', first), second);
          assert.deepEqual(errorPaths(list), [], JSON.stringify(second));
        }
      });

      // A Yes that is disabled, or on another type, does not settle the default.
      if (kind !== 'foreignCurrency') {
        test('two Automatic ones next to a disabled Yes are refused', () => {
          const disabledYes = candidate(kind, 'C', { defaultTender: 'YES' }, { disabled: true });
          assert.ok(refusedOnTheList(listOf(kind, candidate(kind, 'A'), candidate(kind, 'B'), disabledYes)));
        });

        test('two Automatic ones next to a Yes of another type are refused', () => {
          const other = kind === 'voucher' ? 'giftCertificate' : 'voucher';
          const otherYes = candidate(other, 'C', { defaultTender: 'YES' });
          assert.ok(refusedOnTheList(listOf(kind, candidate(kind, 'A'), candidate(kind, 'B'), otherYes)));
        });
      }

      // With several foreign currencies the till always asks the cashier, so
      // none has to be Yes.
      test(
        kind === 'foreignCurrency'
          ? 'two Automatic ones are accepted'
          : 'two Automatic ones are refused',
        () => {
          const list = listOf(kind, candidate(kind, 'A'), candidate(kind, 'B'));
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

describe('che.tender.preview engine scope', () => {
  // Every combination the Checkout Engine supports can be configured; only
  // combinations that break the till are refused.
  const everySetting = {
    behavior: {
      defaultTender: 'NO',
      overpayment: 'WITHOUT_CHANGE',
      blockCancel: true,
      payRemainingAmount: true,
      prefillAmount: true,
      exclusive: false,
      cashDrawer: 'OPEN',
    },
    change: { tenderId: 'CASH', threshold: 10, autoCompleteLimit: 500 },
    refund: { refundsAllowed: 'YES', skipAmountPrompt: true, maxAmount: 100, minAmount: 1 },
    limits: { maxPerSale: 1000, maxPerEntry: 500, minPerEntry: 1 },
    rounding: { method: 'SCIENTIFIC', precision: 0.02 },
  };

  for (const kind of kinds) {
    test(`every setting is accepted on ${kind}`, () => {
      assert.deepEqual(errorPaths([cash, ofKind(kind, 'T', everySetting)]), []);
    });
  }

  test('a card can be the change tender of a voucher', () => {
    const voucher = ofKind('voucher', 'VO', {
      behavior: { overpayment: 'WITH_CHANGE' },
      change: { tenderId: 'CARD' },
    });
    const card = tender('CARD', { kind: 'creditDebit', terminal: 'INTEGRATED_CLOUD' });
    assert.deepEqual(errorPaths([cash, voucher, card]), []);
  });

  test('food stamp and WIC tenders need no item restriction', () => {
    assert.deepEqual(errorPaths([cash, ofKind('foodStamp', 'FS'), ofKind('wicCheck', 'WIC')]), []);
  });

  test('an electronic gift card can be standalone', () => {
    const standalone = tender('EGC', { kind: 'electronicGiftCard', integration: 'STANDALONE' });
    assert.deepEqual(errorPaths([cash, standalone]), []);
    const unknown = tender('EGC', { kind: 'electronicGiftCard', integration: 'CLOUD' });
    assert.ok(errorPaths([cash, unknown]).length > 0);
  });

  test('unknown overpayment and refund choices are refused', () => {
    assert.ok(errorPaths([cash, ofKind('voucher', 'VO', { behavior: { overpayment: 'MAYBE' } })]).length > 0);
    assert.ok(errorPaths([cash, ofKind('voucher', 'VO', { refund: { refundsAllowed: true } })]).length > 0);
  });

  // The replaced fields stay so that tenders saved before still load: the CCC
  // API validates a stored value against the current schema on every read.
  test('a tender saved with the replaced fields still loads', () => {
    const saved = ofKind('voucher', 'VO', {
      behavior: { exactAmountOnly: true },
      refund: { blockRefunds: true },
      rounding: { method: 'MATHEMATICAL', precision: 0.05 },
    });
    assert.deepEqual(errorPaths([cash, saved]), []);
  });
});

describe('che.tender.preview rounding', () => {
  for (const method of ['MATHEMATICAL', 'ROUND_HALF_DOWN', 'SCIENTIFIC']) {
    test(`${method} needs a rounding unit, on any type`, () => {
      for (const kind of ['voucher', 'creditDebit']) {
        const list = [cash, ofKind(kind, 'T', { rounding: { method } })];
        assert.ok(errorPaths(list).includes('/1/rounding'), kind);
      }
    });
  }

  test('no rounding needs no unit', () => {
    assert.deepEqual(errorPaths([cash, ofKind('voucher', 'T', { rounding: { method: 'NO_ROUNDING' } })]), []);
  });

  test('any unit above zero is accepted, zero is refused', () => {
    for (const precision of [0.01, 0.02, 0.2, 100]) {
      const list = [cash, ofKind('voucher', 'T', { rounding: { method: 'MATHEMATICAL', precision } })];
      assert.deepEqual(errorPaths(list), [], String(precision));
    }
    const zero = [cash, ofKind('voucher', 'T', { rounding: { method: 'MATHEMATICAL', precision: 0 } })];
    assert.ok(errorPaths(zero).includes('/1/rounding/precision'));
  });
});

describe('che.tender.preview type defaults', () => {
  // The help texts list by hand the types of each type default group. Each
  // pattern matches its type's name only, not a longer name that contains it.
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
  const kindsOf = (name) => schema.$defs[name].properties.type.properties.kind.enum;
  const sentence = (text, start) => text.slice(text.indexOf(start)).split('. ')[0];

  // Standalone mobile payments and gift cards are named by their connection,
  // not their type, so the type names are checked without them.
  for (const [field, group, start] of [
    [schema.items.properties.behavior.properties.overpayment, 'kindGivesChangeByDefault', 'Type default'],
    [schema.items.properties.refund.properties.refundsAllowed, 'kindRefundsBlockedByDefault', 'Type default'],
  ]) {
    test(`the help text names exactly the types of $defs.${group}`, () => {
      const listed = sentence(field.description, start).replace(/standalone [a-z ]+?(payments|cards)/g, '');
      for (const kind of kinds) {
        assert.equal(nameOf[kind].test(listed), kindsOf(group).includes(kind), kind);
      }
    });
  }
});
