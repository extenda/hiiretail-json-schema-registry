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

// The choices every tender must make; a test overrides them through extra.
const chosen = { overpayment: 'EXACT_AMOUNT', cashDrawer: 'KEEP_CLOSED' };
const tender = (id, type, extra = {}) => ({
  id,
  name: id,
  type,
  ...extra,
  behavior: { ...chosen, ...extra.behavior },
  ...(type.kind !== 'cash' && { refund: { refundsAllowed: 'YES', ...extra.refund } }),
});
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

describe('che.tender.preview lock and block removing the payment', () => {
  // Together they lock the register until the sale is paid in full, which is a valid setup.
  for (const kind of kinds) {
    test(`accepted together on ${kind}`, () => {
      const list = [cash, ofKind(kind, 'T', { behavior: { defaultTender: 'NO', ...lockAndBlock.behavior } })];
      assert.deepEqual(errorPaths(list), []);
    });
  }
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

  // Purchase constraints belong to Entity Conditions, not to the tender.
  test('a tender has no item restriction', () => {
    const restricted = ofKind('foodStamp', 'FS', { restrictionRuleId: 'FOOD' });
    assert.ok(errorPaths([cash, restricted]).length > 0);
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

  // 'Exact Amount Only' and 'Block Refunds' were replaced by the two choices above.
  test('the replaced fields are refused', () => {
    for (const extra of [{ behavior: { exactAmountOnly: true } }, { refund: { blockRefunds: true } }]) {
      assert.ok(errorPaths([cash, ofKind('voucher', 'VO', extra)]).length > 0, JSON.stringify(extra));
    }
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

describe('che.tender.preview required choices', () => {
  // Overpayment, cash drawer and refunds have no type default: every tender states them where they apply.
  const without = (t, group, field) => {
    const copy = structuredClone(t);
    delete copy[group][field];
    return copy;
  };
  const missing = (list, path, field) => {
    validate(list);
    return (validate.errors ?? []).some(
      (e) => e.instancePath === path && e.keyword === 'required' && e.params.missingProperty === field,
    );
  };

  for (const kind of kinds) {
    test(`overpayment and cash drawer are required on ${kind}`, () => {
      const t = ofKind(kind, 'T', { behavior: { defaultTender: 'NO' } });
      assert.ok(missing([cash, without(t, 'behavior', 'overpayment')], '/1/behavior', 'overpayment'));
      assert.ok(missing([cash, without(t, 'behavior', 'cashDrawer')], '/1/behavior', 'cashDrawer'));
    });
  }

  test('a tender without behavior is refused', () => {
    const t = ofKind('voucher', 'T');
    delete t.behavior;
    assert.ok(missing([cash, t], '/1', 'behavior'));
  });

  test('no split payment needs no overpayment, because it takes the exact amount', () => {
    const t = without(ofKind('voucher', 'T', { behavior: { exclusive: true } }), 'behavior', 'overpayment');
    assert.deepEqual(errorPaths([cash, t]), []);
  });

  for (const kind of kinds.filter((k) => k !== 'cash')) {
    test(`refunds are required on ${kind}`, () => {
      const t = ofKind(kind, 'T', { behavior: { defaultTender: 'NO' } });
      assert.ok(missing([cash, without(t, 'refund', 'refundsAllowed')], '/1/refund', 'refundsAllowed'));
      const noRefund = structuredClone(t);
      delete noRefund.refund;
      assert.ok(missing([cash, noRefund], '/1', 'refund'));
    });
  }

  test('no split payment off still needs overpayment, and cash drawer is needed either way', () => {
    for (const exclusive of [false, null]) {
      const t = without(ofKind('voucher', 'T', { behavior: { exclusive } }), 'behavior', 'overpayment');
      assert.ok(missing([cash, t], '/1/behavior', 'overpayment'), String(exclusive));
    }
    const t = without(ofKind('voucher', 'T', { behavior: { exclusive: true } }), 'behavior', 'cashDrawer');
    assert.ok(missing([cash, t], '/1/behavior', 'cashDrawer'));
  });

  // Disabled tenders are checked like every other per-tender rule, so the error shows where the tender is saved.
  test('a disabled tender makes the choices too', () => {
    const t = without(ofKind('voucher', 'T', { disabled: true }), 'behavior', 'overpayment');
    assert.ok(missing([cash, t], '/1/behavior', 'overpayment'));
  });

  // The form hides 'Refunds' on cash but saves the refund limits it shows there.
  test('cash with refund limits needs no refunds choice', () => {
    const limited = tender('CASH', { kind: 'cash' }, { refund: { maxAmount: 50, skipAmountPrompt: true } });
    assert.deepEqual(errorPaths([limited]), []);
  });

  test('cash needs no refunds choice, because it always refunds', () => {
    assert.deepEqual(errorPaths([cash]), []);
    assert.equal(cash.refund, undefined);
  });

  test('type default is no longer an option', () => {
    const choices = [['behavior', 'overpayment'], ['behavior', 'cashDrawer'], ['refund', 'refundsAllowed']];
    for (const [group, field] of choices) {
      const t = ofKind('voucher', 'T', { [group]: { [field]: 'TYPE_DEFAULT' } });
      assert.ok(errorPaths([cash, t]).includes(`/1/${group}/${field}`), field);
    }
  });

  test('$defs holds only the group the form generator reads', () => {
    assert.deepEqual(Object.keys(schema.$defs), ['kindForeignCurrency']);
  });
});

describe('che.tender.preview payment plugin', () => {
  // Store Data derives the plugin from the type; a retailer never names one.
  test('a tender cannot name a payment plugin', () => {
    const named = ofKind('voucher', 'T', { authorization: { plugin: 'GiftCardPluginAuthorizer' } });
    validate([cash, named]);
    assert.ok(validate.errors?.some((e) => e.instancePath === '/1' && e.keyword === 'additionalProperties'
      && e.params.additionalProperty === 'authorization'));
  });

  // What Store Data derives or the form offers would contradict them as an extra attribute.
  test('extra attributes cannot set what Store Data derives or the form sets', () => {
    for (const id of [
      'providerId',
      'Pos.externalAuthorization.authorizer',
      'Pos.externalAuthorization.required',
      'Pos.externalAuthorization.mode',
      'Pos.overTenderAllowed',
      'Pos.void',
    ]) {
      const tender = ofKind('mobile', 'T', { extraAttributes: [{ id, type: 'STRING', value: 'x' }] });
      assert.ok(errorPaths([cash, tender]).includes('/1/extraAttributes/0/id'), id);
    }
    const allowed = ofKind('voucher', 'T', {
      extraAttributes: [{ id: 'Pos.externalAuthorization.authorizationCodeMaximumLength', type: 'INT', value: '6' }],
    });
    assert.deepEqual(errorPaths([cash, allowed]), []);
  });
});
