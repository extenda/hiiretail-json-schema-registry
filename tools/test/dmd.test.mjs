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
    path.join(
      REPO_ROOT,
      'external-events/dmd/dmd.public.event.item-demand-calculated.v1.json',
    ),
    'utf8',
  ),
);

const validate = addFormats(
  new Ajv2020({ strict: true, allErrors: true }),
).compile(schema);

const explain = (errors) =>
  (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');

const check = (message) => ({
  valid: validate(message),
  errors: explain(validate.errors),
});

// Shaped after `toPayloadItem` in hiiretail-demand-processor
// (src/demand-calculation/store-demand-publisher.service.ts), which copies a
// stored `item_demand_rates` row field for field. Constructed rather than
// captured: nothing has published to this topic yet, so there is no real
// message to pull - unlike the grc fixtures next door.
const resolvedItem = (overrides = {}) => ({
  itemId: '7350053850001',
  soldQuantity: 42,
  actualRatePerDay: 1.5,
  stockoutDays: 0.25,
  promotionDaysExcluded: 2,
  baseRatePerDay: 1.75,
  baseRateMissingReason: null,
  cleanInStockDays: 24,
  weeklyTrendFactors: [1.1, 1.05, 0.98, 1.0],
  trendSource: 'STORE',
  trendCategoryId: 'cat-dairy',
  trendMissingReason: null,
  isTrendClamped: false,
  ...overrides,
});

// The other half of the producer's output: `calculateItemDemandRate` leaves
// `baseRatePerDay` null and records a reason, and `noneOutcome` in
// trend-ladder.ts pairs `trendSource: NONE` with a null category and a reason.
const unresolvedItem = (overrides = {}) => ({
  ...resolvedItem(),
  baseRatePerDay: null,
  baseRateMissingReason: 'NO_CLEAN_DAYS',
  weeklyTrendFactors: [1, 1, 1, 1],
  trendSource: 'NONE',
  trendCategoryId: null,
  trendMissingReason: 'NO_HISTORY',
  ...overrides,
});

const message = (items) => ({
  tenantId: 'CIR7nQwtS0rA6t0S6ejd',
  businessUnitId: 'EU002',
  calculationDate: '2026-11-16',
  windowWeeks: 8,
  weeksAhead: 4,
  calculatedDatetime: '2026-11-16T03:00:00.000Z',
  chunkIndex: 1,
  chunkCount: 1,
  items,
});

describe('dmd.public.event.item-demand-calculated.v1', () => {
  test('resolves as a self-contained document under draft 2020-12', () => {
    assert.equal(typeof validate, 'function');
  });

  // The two shapes below are what the producer actually emits. They are
  // asserted valid first so every rejection test underneath is a one-field
  // mutation of a message known to pass - otherwise a conditional with a typo
  // in its property name would reject everything and still look like it works.
  test('an item with a resolved rate and a resolved trend validates', () => {
    const { valid, errors } = check(message([resolvedItem()]));
    assert.ok(valid, errors);
  });

  test('an item with a missing rate and no trend validates', () => {
    const { valid, errors } = check(message([unresolvedItem()]));
    assert.ok(valid, errors);
  });

  describe('the chunk size the contract advertises', () => {
    test('a full chunk of 500 articles validates', () => {
      const items = Array.from({ length: 500 }, (_, i) =>
        resolvedItem({ itemId: `item-${i}` }),
      );
      const { valid, errors } = check(message(items));
      assert.ok(valid, errors);
    });

    // `ITEM_DEMAND_PUBLISH_CHUNK_SIZE = 500` in the producer, and AC1 of
    // HII-14323 states the same cap. Without maxItems the description promised
    // a bound that nothing enforced.
    test('a chunk of 501 articles is rejected', () => {
      const items = Array.from({ length: 501 }, (_, i) =>
        resolvedItem({ itemId: `item-${i}` }),
      );
      assert.equal(check(message(items)).valid, false);
    });

    test('an empty chunk is rejected', () => {
      assert.equal(check(message([])).valid, false);
    });
  });

  // calculateItemDemandRate either divides out a rate or sets one of the three
  // reasons - never both, never neither. A subscriber reading baseRatePerDay
  // needs the reason to be present exactly when the rate is absent.
  describe('baseRatePerDay and baseRateMissingReason', () => {
    test('a null rate with no reason is rejected', () => {
      const item = unresolvedItem({ baseRateMissingReason: null });
      assert.equal(check(message([item])).valid, false);
    });

    test('a resolved rate carrying a reason is rejected', () => {
      const item = resolvedItem({ baseRateMissingReason: 'NO_CLEAN_DAYS' });
      assert.equal(check(message([item])).valid, false);
    });

    test('each missing reason is accepted with a null rate', () => {
      for (const reason of [
        'NO_IN_STOCK_TIME',
        'NO_CLEAN_DAYS',
        'NO_WINDOW_DAYS',
      ]) {
        const item = unresolvedItem({ baseRateMissingReason: reason });
        const { valid, errors } = check(message([item]));
        assert.ok(valid, `${reason}: ${errors}`);
      }
    });
  });

  // `noneOutcome` and `wonOutcome` in trend-ladder.ts are the only two
  // constructors, and wonOutcome is never called with NONE - it takes a
  // non-null category id and nulls the reason.
  describe('trendSource, trendCategoryId and trendMissingReason', () => {
    test('NONE carrying a category id is rejected', () => {
      const item = unresolvedItem({ trendCategoryId: 'cat-dairy' });
      assert.equal(check(message([item])).valid, false);
    });

    test('NONE with no missing reason is rejected', () => {
      const item = unresolvedItem({ trendMissingReason: null });
      assert.equal(check(message([item])).valid, false);
    });

    test('a resolved source carrying a missing reason is rejected', () => {
      const item = resolvedItem({ trendMissingReason: 'NO_CATEGORY' });
      assert.equal(check(message([item])).valid, false);
    });

    test('a resolved source with no category id is rejected', () => {
      const item = resolvedItem({ trendCategoryId: null });
      assert.equal(check(message([item])).valid, false);
    });

    test('every resolved level of the ladder validates', () => {
      for (const source of ['STORE', 'COUNTRY', 'CHAIN']) {
        const { valid, errors } = check(
          message([resolvedItem({ trendSource: source })]),
        );
        assert.ok(valid, `${source}: ${errors}`);
      }
    });

    test('each trend missing reason is accepted with NONE', () => {
      for (const reason of [
        'NO_HISTORY',
        'NO_CATEGORY',
        'INSUFFICIENT_VOLUME',
      ]) {
        const item = unresolvedItem({ trendMissingReason: reason });
        const { valid, errors } = check(message([item]));
        assert.ok(valid, `${reason}: ${errors}`);
      }
    });
  });
});
