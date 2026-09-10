#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { flatten, merge } from './flatten.mjs';

const TOOLS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(TOOLS_DIR);

// Property order of the published file. Anything not listed keeps source order
// after these, so a new contracts keyword shows up rather than being dropped.
const ROOT_KEY_ORDER = [
  '$id',
  '$schema',
  'title',
  'description',
  'type',
  'required',
  'additionalProperties',
  'properties',
  '$defs',
];

const orderKeys = (obj) => {
  const out = {};
  for (const key of ROOT_KEY_ORDER) if (key in obj) out[key] = obj[key];
  for (const key of Object.keys(obj)) if (!(key in out)) out[key] = obj[key];
  return out;
};

export function build(entry, contractsDir) {
  const sourceFile = path.join(contractsDir, entry.source);
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Contracts source not found: ${sourceFile}`);
  }

  const { root, $defs } = flatten(sourceFile);

  // A contract may carry its own local $defs alongside the sibling-file $refs.
  // Replacing rather than merging would drop them and leave the `#/$defs/...`
  // pointers that reference them dangling - a definition silently lost during
  // flattening, which is the exact failure HII-13841 exists to fix.
  const localDefs = root.$defs ?? {};
  const collision = Object.keys(localDefs).find((name) => name in $defs);
  if (collision) {
    throw new Error(
      `$defs/${collision} is defined locally in ${entry.source} and also hoisted from a sibling file`,
    );
  }
  const allDefs = { ...localDefs, ...$defs };

  const document = {
    $id: entry.$id,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...root,
    ...(Object.keys(allDefs).length ? { $defs: allDefs } : {}),
  };

  assertPresentationOnly(entry.overrides);
  return `${stringify(orderKeys(merge(document, entry.overrides ?? {})))}\n`;
}

// An override exists to reword what an integrator reads, never to change what
// validates. Unchecked it could set `required`, `type` or `additionalProperties`
// just as easily as `title`, and because --check regenerates *with* overrides
// applied, CI would be comparing the output against contracts-plus-overrides and
// see no drift. That is the one remaining route by which a published schema can
// silently disagree with its contract - the defect this generator exists to stop.
const PRESENTATION_KEYWORDS = new Set(['title', 'description', '$comment']);
const MAP_CONTAINERS = new Set(['properties', '$defs']);

function assertPresentationOnly(patch, at = '') {
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (MAP_CONTAINERS.has(key)) {
      for (const [name, sub] of Object.entries(value)) {
        assertPresentationOnly(sub, `${at}/${key}/${name}`);
      }
    } else if (key === 'items') {
      assertPresentationOnly(value, `${at}/items`);
    } else if (!PRESENTATION_KEYWORDS.has(key)) {
      throw new Error(
        `Override ${at}/${key} is not a presentation keyword - change the contract instead`,
      );
    }
  }
}

// JSON.stringify puts every array element on its own line. That is unreadable
// for `type` unions - the keyword every nullability fix in HII-13841 touched -
// so those stay on one line, as they are in the hand-written files around them.
const INLINE = '@@inline@@';

function stringify(document) {
  const marked = JSON.parse(JSON.stringify(document), function reviver(key, value) {
    if (key === 'type' && Array.isArray(value)) {
      return `${INLINE}[${value.map((v) => JSON.stringify(v)).join(', ')}]${INLINE}`;
    }
    return value;
  });

  return JSON.stringify(marked, null, 2).replace(
    new RegExp(`"${INLINE}(.*?)${INLINE}"`, 'g'),
    (_, inner) => inner.replace(/\\"/g, '"'),
  );
}

function main() {
  const { values } = parseArgs({
    options: {
      contracts: { type: 'string' },
      check: { type: 'boolean', default: false },
    },
  });

  const contractsDir = path.resolve(
    values.contracts ?? path.join(REPO_ROOT, '..', 'hiiretail-contracts-logistics', 'schemas', 'json'),
  );
  const { schemas } = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'sources.json'), 'utf8'));

  const drifted = [];
  for (const entry of schemas) {
    const generated = build(entry, contractsDir);
    const outputFile = path.join(REPO_ROOT, entry.output);

    if (values.check) {
      const current = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
      if (current !== generated) drifted.push(entry.output);
      continue;
    }

    fs.writeFileSync(outputFile, generated);
    console.log(`generated ${entry.output}`);
  }

  if (drifted.length) {
    console.error(
      `Committed schemas differ from the generated output:\n${drifted.map((f) => `  - ${f}`).join('\n')}\n\n` +
        'Run "npm --prefix tools run generate" against a hiiretail-contracts-logistics checkout and commit the result.',
    );
    process.exit(1);
  }

  if (values.check) console.log(`${schemas.length} generated schema(s) up to date`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
