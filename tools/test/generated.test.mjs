import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { build } from '../src/generate.mjs';

const TOOLS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(TOOLS_DIR);

const contractsDir = path.resolve(
  process.env.CONTRACTS_DIR ??
    path.join(REPO_ROOT, '..', 'hiiretail-contracts-logistics', 'schemas', 'json'),
);

const { schemas } = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'sources.json'), 'utf8'));

for (const entry of schemas) {
  test(`${entry.output} matches the generated output`, { skip: skipReason() }, () => {
    const committed = fs.readFileSync(path.join(REPO_ROOT, entry.output), 'utf8');
    assert.equal(
      build(entry, contractsDir),
      committed,
      `${entry.output} was hand-edited or the contract moved on. ` +
        'Run "npm --prefix tools run generate" and commit the result.',
    );
  });
}

function skipReason() {
  return fs.existsSync(contractsDir)
    ? false
    : `no hiiretail-contracts-logistics checkout at ${contractsDir}`;
}
