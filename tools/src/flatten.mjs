import fs from 'node:fs';
import path from 'node:path';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const rel = (file) => path.relative(process.cwd(), file);

// Keys that belong to a standalone contracts file and must not survive inlining.
const FILE_LEVEL_KEYS = new Set(['id', '$id', '$schema']);

// A scalar is inlined at the use site so its allowed values are visible where
// the field is declared. Anything else - an object, or a schema composed with
// allOf/anyOf and no `type` of its own - becomes a $defs entry, so a definition
// reached from two places is written once rather than duplicated.
const PRIMITIVES = new Set(['string', 'number', 'integer', 'boolean', 'null']);

const isScalar = (body) => {
  if (body.enum !== undefined) return true;
  const types = Array.isArray(body.type) ? body.type : [body.type];
  return types.every((type) => type !== undefined && PRIMITIVES.has(type));
};

// Keywords that only describe a schema and never affect what validates. These
// are the only ones allowed beside an inlined $ref, where they override the
// target's. Anything else beside a $ref is evaluated *alongside* the target
// (draft 2020-12), as a logical AND, so overriding it would change what the
// published file accepts.
const ANNOTATION_KEYWORDS = new Set([
  'title',
  'description',
  '$comment',
  'examples',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

const isFileRef = (node) =>
  node && typeof node === 'object' && typeof node.$ref === 'string' && !node.$ref.startsWith('#');

/**
 * Inline a contracts schema into a single self-contained document.
 *
 * Sibling-file `$ref`s are resolved two different ways, because the two cases
 * mean different things to an integrator reading the published file:
 *
 *   - a $ref to an *object* schema becomes an entry in `$defs`, keyed by the
 *     target's `title`, and the reference becomes `#/$defs/<title>`;
 *   - a $ref to a *scalar* schema (an enum such as ShipperType) is inlined at
 *     the use site, so the allowed values are visible where the field is
 *     declared rather than one indirection away.
 *
 * Dropping a $ref instead of resolving it is what produced HII-13841: a
 * `$ref`ed property vanished from the published schema while the producer kept
 * sending it, and the root is `additionalProperties: false`.
 */
export function flatten(sourceFile) {
  const $defs = {};

  const escapePointer = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

  // `pointer` is the node's JSON pointer within the file at stack.at(-1), kept
  // only so an error can say where in that file the problem is.
  const walk = (node, dir, stack, pointer = '') => {
    if (Array.isArray(node)) {
      return node.map((child, index) => walk(child, dir, stack, `${pointer}/${index}`));
    }
    if (!node || typeof node !== 'object') return node;

    if (isFileRef(node)) {
      const target = path.resolve(dir, node.$ref);
      // Name the file holding the bad $ref, not just its directory - after a
      // few levels of recursion the directory alone does not identify it.
      if (!fs.existsSync(target)) {
        throw new Error(`Unresolved $ref '${node.$ref}' in ${rel(stack.at(-1))}`);
      }
      if (stack.includes(target)) {
        throw new Error(`Circular $ref '${node.$ref}' via ${stack.map(rel).join(' -> ')}`);
      }

      const { title, ...raw } = readJson(target);
      const body = strip(raw);
      const nested = [...stack, target];

      if (!title || isScalar(body)) {
        // Annotations next to the $ref (typically a field-level `description`)
        // are the use site's own words about the field, so they win over the
        // target's. Dropping them silently replaced the field description with
        // the enum's generic one. They are data, not schema, so they are not
        // walked.
        //
        // Any other keyword would be AND-ed with the target by a validator.
        // Merging it as an override would widen or narrow the schema, and
        // combining it ourselves would be a guess, so refuse.
        const { $ref, ...siblings } = node;
        const validating = Object.keys(siblings).filter((key) => !ANNOTATION_KEYWORDS.has(key));
        if (validating.length > 0) {
          throw new Error(
            `Keywords beside $ref '${node.$ref}' cannot be merged: ${validating.join(', ')}` +
              ` (at ${pointer || '/'} in ${rel(stack.at(-1))}). ` +
              `Only annotation keywords (${[...ANNOTATION_KEYWORDS].join(', ')}) may override an inlined $ref; ` +
              `a validation keyword is evaluated alongside the target, not instead of it.`,
          );
        }
        return { ...walk(body, path.dirname(target), nested), ...siblings };
      }

      // A $defs entry is shared by every use site, so there is nowhere to put
      // keywords written next to one reference. Dropping them silently is the
      // same loss as the scalar case above; refuse instead.
      const { $ref, ...dropped } = node;
      if (Object.keys(dropped).length > 0) {
        throw new Error(
          `Keywords beside $ref '${node.$ref}' would be dropped: ${Object.keys(dropped).join(', ')}` +
            ` (at ${pointer || '/'} in ${rel(stack.at(-1))}). ` +
            `A $ref to the titled object ${title} becomes a shared $defs entry and cannot carry them.`,
        );
      }

      if (!(title in $defs)) {
        // Reserve the key before recursing so $defs keeps discovery order:
        // a definition is listed before the definitions it references.
        $defs[title] = null;
        $defs[title] = walk(body, path.dirname(target), nested);
      }
      return { $ref: `#/$defs/${title}` };
    }

    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = walk(value, dir, stack, `${pointer}/${escapePointer(key)}`);
    }
    return out;
  };

  const strip = (node) => {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (!FILE_LEVEL_KEYS.has(key)) out[key] = value;
    }
    return out;
  };

  const source = readJson(sourceFile);
  const root = walk(strip(source), path.dirname(sourceFile), [path.resolve(sourceFile)]);

  return { root, $defs };
}

/** Deep merge used to apply per-schema overrides; non-objects replace wholesale. */
export function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  if (!base || typeof base !== 'object' || Array.isArray(base)) return { ...patch };
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = merge(base[key], value);
  return out;
}
