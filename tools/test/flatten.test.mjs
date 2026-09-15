import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { flatten } from '../src/flatten.mjs';
import { build } from '../src/generate.mjs';

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'flatten-test-'));
after(() => fs.rmSync(workdir, { recursive: true, force: true }));

const write = (name, body) => {
  const file = path.join(workdir, name);
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
  return file;
};

write('Colour.schema.json', {
  id: 'test.Colour',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Colour',
  description: 'Colour',
  type: 'string',
  enum: ['red', 'green'],
});

write('PartDto.schema.json', {
  id: 'test.PartDto',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PartDto',
  type: 'object',
  required: ['partId'],
  additionalProperties: false,
  properties: {
    partId: { type: 'string' },
    colour: { $ref: 'Colour.schema.json' },
  },
});

const rootFile = write('root.schema.json', {
  id: 'test.root',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Root',
  type: 'object',
  required: ['colour', 'parts'],
  additionalProperties: false,
  properties: {
    colour: { $ref: 'Colour.schema.json' },
    parts: { type: 'array', items: { $ref: 'PartDto.schema.json' } },
  },
});

test('a $refed scalar is inlined at the use site, enum and all', () => {
  const { root } = flatten(rootFile);
  assert.deepEqual(root.properties.colour, {
    description: 'Colour',
    type: 'string',
    enum: ['red', 'green'],
  });
});

test('a $refed object becomes a $defs entry keyed by its title', () => {
  const { root, $defs } = flatten(rootFile);
  assert.deepEqual(root.properties.parts.items, { $ref: '#/$defs/PartDto' });
  assert.equal($defs.PartDto.type, 'object');
  // The nested $ref inside the hoisted definition is resolved too.
  assert.deepEqual($defs.PartDto.properties.colour.enum, ['red', 'green']);
});

test('file-level keys never leak into the published document', () => {
  const { root, $defs } = flatten(rootFile);
  for (const node of [root, $defs.PartDto]) {
    assert.equal('id' in node, false);
    assert.equal('$schema' in node, false);
  }
  // The title becomes the $defs key, so it is not repeated inside the entry.
  assert.equal('title' in $defs.PartDto, false);
});

test('$defs are listed in discovery order, definers before their references', () => {
  const { $defs } = flatten(rootFile);
  assert.deepEqual(Object.keys($defs), ['PartDto']);
});

// This is the HII-13841 regression guard: shipperType was lost because it was a
// $ref to a sibling file, and nothing proved that adding such a property to the
// contract reaches the published schema.
test('a newly $refed contract property propagates with no generator change', () => {
  write('Material.schema.json', {
    id: 'test.Material',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Material',
    type: 'string',
    enum: ['steel', 'wood'],
  });

  const source = JSON.parse(fs.readFileSync(rootFile, 'utf8'));
  source.properties.material = { $ref: 'Material.schema.json' };
  source.required.push('material');
  fs.writeFileSync(rootFile, JSON.stringify(source, null, 2));

  const { root } = flatten(rootFile);
  assert.deepEqual(root.properties.material.enum, ['steel', 'wood']);
  assert.ok(root.required.includes('material'));
});

test('an unresolvable $ref fails loudly instead of being dropped', () => {
  const broken = write('broken.schema.json', {
    id: 'test.broken',
    title: 'Broken',
    type: 'object',
    properties: { gone: { $ref: 'DoesNotExist.schema.json' } },
  });
  assert.throws(() => flatten(broken), /Unresolved \$ref/);
});

// The generator merges a contract's own local $defs with the ones hoisted from
// sibling files. Replacing instead of merging would drop the local entries and
// leave their `#/$defs/...` pointers dangling - a definition lost during
// flattening, which is the failure HII-13841 exists to fix.
test('local $defs survive alongside the ones hoisted from sibling files', () => {
  const source = 'withLocalDefs.schema.json';
  write(source, {
    id: 'test.withLocalDefs',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'WithLocalDefs',
    type: 'object',
    required: ['colour', 'note'],
    additionalProperties: false,
    properties: {
      colour: { $ref: 'Colour.schema.json' },
      parts: { type: 'array', items: { $ref: 'PartDto.schema.json' } },
      note: { $ref: '#/$defs/Note' },
    },
    $defs: {
      Note: {
        type: 'object',
        required: ['text'],
        additionalProperties: false,
        properties: { text: { type: 'string' } },
      },
    },
  });

  const built = JSON.parse(build({ source, $id: 'test.withLocalDefs' }, workdir));

  assert.deepEqual(Object.keys(built.$defs).sort(), ['Note', 'PartDto']);
  assert.deepEqual(built.properties.note, { $ref: '#/$defs/Note' });
  assert.equal(built.$defs.Note.properties.text.type, 'string');
});

test('a local $defs name clashing with a hoisted one fails loudly', () => {
  const source = 'clashingDefs.schema.json';
  write(source, {
    id: 'test.clashingDefs',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ClashingDefs',
    type: 'object',
    additionalProperties: false,
    properties: { parts: { type: 'array', items: { $ref: 'PartDto.schema.json' } } },
    $defs: { PartDto: { type: 'object', properties: { somethingElse: { type: 'string' } } } },
  });

  assert.throws(
    () => build({ source, $id: 'test.clashingDefs' }, workdir),
    /\$defs\/PartDto is defined locally/,
  );
});

// An override may reword the published schema, never change what validates.
// --check regenerates with overrides applied, so a substantive one would make
// the output disagree with its contract while CI still reported no drift.
test('presentation overrides are applied, at any depth', () => {
  const source = 'overridable.schema.json';
  write(source, {
    id: 'test.overridable',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Overridable',
    description: 'from the contract',
    type: 'object',
    additionalProperties: false,
    properties: { parts: { type: 'array', items: { $ref: 'PartDto.schema.json' } } },
  });

  const built = JSON.parse(
    build(
      {
        source,
        $id: 'test.overridable',
        overrides: {
          description: 'reworded for the developer portal',
          $defs: { PartDto: { properties: { partId: { description: 'the part id' } } } },
        },
      },
      workdir,
    ),
  );

  assert.equal(built.description, 'reworded for the developer portal');
  assert.equal(built.$defs.PartDto.properties.partId.description, 'the part id');
  assert.equal(built.$defs.PartDto.properties.partId.type, 'string');
});

test('a substantive override is refused rather than silently published', () => {
  const entry = { source: 'overridable.schema.json', $id: 'test.overridable' };

  assert.throws(
    () => build({ ...entry, overrides: { required: [] } }, workdir),
    /Override \/required is not a presentation keyword/,
  );
  assert.throws(
    () => build({ ...entry, overrides: { additionalProperties: true } }, workdir),
    /Override \/additionalProperties is not a presentation keyword/,
  );
});

test('a substantive override is caught inside a container, and named by path', () => {
  assert.throws(
    () =>
      build(
        {
          source: 'overridable.schema.json',
          $id: 'test.overridable',
          overrides: { $defs: { PartDto: { properties: { partId: { type: 'number' } } } } },
        },
        workdir,
      ),
    /Override \/\$defs\/PartDto\/properties\/partId\/type is not a presentation keyword/,
  );
});

test('a composed schema with a title is hoisted, not duplicated at each use', () => {
  // StockCountData is $refed from both StockCountItem and StockCountLocation,
  // and uses allOf/unevaluatedProperties with no `type` of its own. Keying the
  // hoist off `type === "object"` inlined it twice; keying it off the title
  // writes it once.
  write('Composed.schema.json', {
    id: 'test.Composed',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Composed',
    unevaluatedProperties: false,
    allOf: [{ properties: { a: { type: 'string' } } }],
  });

  const source = write('twoUses.schema.json', {
    id: 'test.twoUses',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'TwoUses',
    type: 'object',
    additionalProperties: false,
    properties: {
      first: { $ref: 'Composed.schema.json' },
      second: { $ref: 'Composed.schema.json' },
    },
  });

  const { root, $defs } = flatten(source);

  assert.deepEqual(root.properties.first, { $ref: '#/$defs/Composed' });
  assert.deepEqual(root.properties.second, { $ref: '#/$defs/Composed' });
  assert.equal($defs.Composed.unevaluatedProperties, false);
});

test('an untitled schema is inlined rather than refused', () => {
  // There is no name to key a $defs entry by, and inlining is still correct -
  // it just cannot be shared between uses.
  write('Untitled.schema.json', {
    id: 'test.Untitled',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { a: { type: 'string' } },
  });

  const source = write('usesUntitled.schema.json', {
    id: 'test.usesUntitled',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'UsesUntitled',
    type: 'object',
    properties: { thing: { $ref: 'Untitled.schema.json' } },
  });

  const { root, $defs } = flatten(source);

  assert.equal(root.properties.thing.properties.a.type, 'string');
  assert.deepEqual(Object.keys($defs), []);
});
