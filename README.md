# hiiretail-json-schema-registry

Hii Retail public JSON schema registry

## Structure

- [customer-config](./customer-config/)
- [external-events](./external-events/)

Each directory is representing a 'service-consumer' of schemas. For example external events
schemas for event sources can be found in [external-events](./external-events/)

Each directory on top level has sub directories like:

- [customer-config/cloud-core](./customer-config/cloud-core)

Directory on `2nd` level represent team owner of schema.

Each directory on `2nd` level contains schemas.

Schema file name has following structure:

```
{name-of-entity}      {extention}
che.receipt-layout.v1.json
```

A version is name is encouraged. If it is not presented in entity name,
please add it before `extention`

*IMPORTANT*

> Keep schemas immutable. that makes it easier for consumer of schemas

TODO: @glebbash add 

## How to add a schema?

TODO: @glebbash

## How to use schema

TODO: @glebbash 
