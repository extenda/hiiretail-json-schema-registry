# hiiretail-json-schema-registry

![Action](https://github.com/extenda/hiiretail-json-schema-registry/actions/workflows/sync-action.yaml/badge.svg)
![CCC Sync](https://github.com/extenda/hiiretail-json-schema-registry/actions/workflows/ccc-schema-pr.yaml/badge.svg)

Hii Retail public JSON schema registry

## Structure

- [customer-config](./customer-config/)
- [external-events](./external-events/)

Each directory is representing a 'service-consumer' of schemas. For example external events
schemas for event sources can be found in [external-events](./external-events/)

Each directory on top level has sub directories like:

- [customer-config/cloud-core](./customer-config/cloud-core)

Directories on `2nd` level represent team names of owner of contained schemas.

Each directory on `2nd` level contains schemas.

Schema file name has following structure:

```
{name-of-entity}      {extention}
che.receipt-layout.v1.json
```

A version name is encouraged. If it is not present in entity name please add it before `{extention}`

*IMPORTANT*

> Keep schemas immutable. That makes it easier for consumers of schemas

## Generated external-events schemas

Files under [external-events](./external-events/) are **generated** from
[hiiretail-contracts-logistics](https://github.com/extenda/hiiretail-contracts-logistics)
and must not be hand-edited. Which ones are listed in
[tools/sources.json](./tools/sources.json).

Every *other* file under `external-events/` is listed in
[tools/unmanaged.json](./tools/unmanaged.json) with the reason it is not
generated — no contract exists for it, it is a fragment rather than an event, or
it is owned by another team. **CI fails if a file appears in neither list**, so a
new schema has to declare which it is rather than quietly joining the
hand-maintained pile. That check is the point: generating three files and leaving
fifty-five unexamined is how the same drift reached `grc`, `scr` and `stc`
independently.

The contracts repo splits a schema across sibling files and `$ref`s between
them; the registry publishes one self-contained document. Flattening is where
things get lost: HII-13841 was a `$ref`ed property (`shipperType`) that never
made it into the published copy, on a schema whose root is
`additionalProperties: false` - so every real message failed validation for any
external subscriber that checked its input.

To change one of these schemas, change the contract, then regenerate:

```sh
npm --prefix tools ci
npm --prefix tools run generate            # expects ../hiiretail-contracts-logistics
npm --prefix tools run generate -- --contracts /path/to/schemas/json
npm --prefix tools test
```

CI re-runs the generation on every pull request and fails if the committed file
differs, so a hand-edit and a not-yet-propagated contract change both show up as
a red build. The same run fails if a file under `external-events/` is in neither
manifest.

Two rules the generator enforces, both learned from real defects:

- a `$ref` is resolved or the build fails — never dropped. A `$ref`ed property
  silently vanishing is what HII-13841 was.
- the published document is self-contained. A relative `$ref` to a file that does
  not exist in this repo makes the schema unresolvable for every subscriber,
  which is what `stc.public.event.stock-count-completed.v1` shipped with.

`tools/sources.json` carries a small `overrides` patch per schema, for the
places where the published wording is deliberately not the contract's - the
registry file is what an integrator actually reads. Field names, types and
required-ness always come from the contract.

## Usage in configuration service

[Guide for using schemas in Customer Controlled Configuration](https://developer.hiiretail.com/docs/customer-controlled-configuration/public/concepts/CONFIG-KIND/#config-schema)

### Schema validation and synchronization

:point_right: Adding or modifying schema under [customer-config](./customer-config/) will be validated and synchronized to [CCC-API](https://developer.hiiretail.com/docs/customer-controlled-configuration/public/README).

1. `$schema` MUST be `draft/2020-12/schema` (`draft/07/schema` is not supported at this time)
2. If the schema is not defined in CCC on any configuration definition validation will be skipped.
3. New schema value MUST be backwards-compatible.

If these conditions are not met the workflow will let you know what is wrong.
