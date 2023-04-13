# hiiretail-json-schema-registry

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

## Usage in configuration service

[Guide for using schemas in Customer Controlled Configuration](https://developer.hiiretail.com/docs/customer-controlled-configuration/public/concepts/CONFIG-KIND/#config-schema)
