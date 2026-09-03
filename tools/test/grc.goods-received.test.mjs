import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(path.dirname(TEST_DIR));

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fixture = (name) => readJson(path.join(TEST_DIR, 'fixtures', name));

const schema = readJson(
  path.join(REPO_ROOT, 'external-events', 'grc', 'grc.public.event.goods-received.v1.json'),
);

// Formats are asserted, not just annotated. An external subscriber is free to
// check them, so the fixtures have to survive it: bestBeforeDate and
// expirationDate carry a calendar date ("2024-11-01") and are declared
// `format: date` since HII-13805, and the Spanner timestamps in deliveryDate
// keep nine fractional digits.
const validate = addFormats(new Ajv2020({ strict: true, allErrors: true })).compile(schema);

const check = (message) => {
  const valid = validate(message);
  return { valid, errors: validate.errors ?? [] };
};

const explain = (errors) =>
  errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');

test('the schema itself compiles under draft 2020-12', () => {
  assert.equal(typeof validate, 'function');
});

// HII-13841: this is the defect. Every published message carries shipperType,
// the root is additionalProperties: false, and the published schema did not
// declare it - so an external subscriber that validates rejected 100% of them.
test('a real published message with a priced line validates', () => {
  const { valid, errors } = check(fixture('priced-line.json'));
  assert.ok(valid, explain(errors));
});

test('a real published message with an unpriced line validates', () => {
  const message = fixture('unpriced-line.json');
  assert.equal(message.lines[0].unitPrice, null);
  assert.equal(message.lines[0].currencyCode, null);

  const { valid, errors } = check(message);
  assert.ok(valid, explain(errors));
});

test('shipperType is declared and required, with its enum inlined', () => {
  assert.deepEqual(schema.properties.shipperType.enum, ['businessPartnerId', 'businessUnitId']);
  assert.ok(schema.required.includes('shipperType'));

  const { shipperType, ...withoutShipperType } = fixture('priced-line.json');
  assert.equal(check(withoutShipperType).valid, false);
});

test('an unknown shipperType is rejected', () => {
  const message = { ...fixture('priced-line.json'), shipperType: 'supplierId' };
  assert.equal(check(message).valid, false);
});

// Decided in HII-13841: lineNumber is removed rather than added to contracts.
// The producer has never set it, so advertising it told integrators to wait for
// a field that will never arrive.
test('lineNumber is not advertised, and a message carrying one is rejected', () => {
  assert.equal('lineNumber' in schema.$defs.LineDto.properties, false);

  const message = fixture('priced-line.json');
  message.lines[0].lineNumber = 1;
  assert.equal(check(message).valid, false);
});
