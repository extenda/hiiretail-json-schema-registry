import fs from 'node:fs';
import path from 'node:path';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const rel = (file) => path.relative(process.cwd(), file);

// Keys that belong to a standalone contracts file and must not survive inlining.
const FILE_LEVEL_KEYS = new Set(['id', '$id', '$schema']);

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

  const walk = (node, dir, stack) => {
    if (Array.isArray(node)) return node.map((child) => walk(child, dir, stack));
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

      if (body.type !== 'object') return walk(body, path.dirname(target), nested);

      if (!title) throw new Error(`Object schema ${node.$ref} has no title to key $defs by`);
      if (!(title in $defs)) {
        // Reserve the key before recursing so $defs keeps discovery order:
        // a definition is listed before the definitions it references.
        $defs[title] = null;
        $defs[title] = walk(body, path.dirname(target), nested);
      }
      return { $ref: `#/$defs/${title}` };
    }

    const out = {};
    for (const [key, value] of Object.entries(node)) out[key] = walk(value, dir, stack);
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
