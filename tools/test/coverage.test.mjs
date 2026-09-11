import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { auditCoverage } from '../src/generate.mjs';

const TOOLS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(TOOLS_DIR);

const readJson = (name) =>
  JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, name), 'utf8'));

const { schemas } = readJson('sources.json');
const { unmanaged } = readJson('unmanaged.json');

// grc, scr and stc each drifted from their contract independently, and each was
// found by someone reading the file rather than by a check. Generating three
// files leaves the rest hand-maintained with nothing recording that - so every
// file has to declare which it is.
test('every external-events schema is either generated or declared unmanaged', () => {
  const { undeclared, stale, both } = auditCoverage(schemas, unmanaged, REPO_ROOT);

  assert.deepEqual(undeclared, [], 'files in neither list');
  assert.deepEqual(stale, [], 'declared unmanaged but no longer present');
  assert.deepEqual(both, [], 'declared unmanaged and generated at once');
});

test('every unmanaged entry says why it is not generated', () => {
  const missing = unmanaged.filter((entry) => !entry.reason?.trim());

  assert.deepEqual(missing, [], 'unmanaged entries with no reason');
});

test('an undeclared file is reported', () => {
  const { undeclared } = auditCoverage([], unmanaged, REPO_ROOT);

  // The three generated files are not in unmanaged.json, so dropping the
  // generated list must surface exactly them.
  assert.deepEqual(undeclared, schemas.map((entry) => entry.output).sort());
});
