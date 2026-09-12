# PCH master-data schema

Based on `pch_master_data_schema.sql` and **PCH Master Data, Relationships & UI Mapping**, version 1.0, September 2026, especially sections 3-6, 8 and 13. The supplied SQL already defines all 20 documented tables. The repository lacked the ten relationship tables listed below.

## SQL files

| File | Purpose |
| --- | --- |
| `pch_master_data_schema.sql` | Complete 20-table schema for a new, empty database. Uses the supplied UUID model, with enforced tenant ownership and parent-before-child creation order. Fails on existing tables rather than silently accepting incompatible definitions. |
| `03_master_data_relationships.sql` | Additive migration for an existing database with the ten parent tables already installed. Creates the ten missing relationship tables, foreign keys, uniqueness constraints, date checks and indexes. Reads parent ID types from PostgreSQL and supports both `merchant_id` and `"merchantId"` ownership columns on stores/subscriptions. |

Both files run in a transaction. PostgreSQL 14 or later supplies `gen_random_uuid()` without an additional extension. No data or role/feature grants are seeded. The migration can be repeated against the schema it creates; it is not a repair tool for previously created, differently shaped relationship tables. If a parent has both legacy and new ownership columns, it fails rather than guessing which contains the authoritative merchant ID.

The files have been tested on a disposable PostgreSQL 18 instance. The relationship migration was subsequently applied to the freshly recreated local Docker database `pinaka_commerce_hub` on 2026-09-12. The canonical UUID schema remains a separate new-install design. The original Downloads files are unchanged.

## Hierarchy and missing tables

| Hierarchy | Relationship table | UI location in the document |
| --- | --- | --- |
| Store type -> feature defaults | `store_type_features` | Master Setup / Store Types / Features |
| Store type -> role templates | `store_type_role_templates` | Master Setup / Store Types / Role Templates |
| Role template -> permissions | `role_template_permissions` | Master Setup / Role Templates / Permissions |
| Plan -> feature entitlement | `plan_entitlements` | Master Setup / Plans / Features & Entitlements |
| Merchant subscription -> licensed stores | `subscription_stores` | Merchant Details / Subscription / Licensed Stores |
| Subscription -> feature overrides | `subscription_entitlements` | Merchant Details / Entitlements |
| Store -> feature overrides | `store_entitlements` | Store Details / Entitlements |
| Merchant employee -> store assignments | `employee_stores` | Employee Details / Store Assignments |
| Employee-store assignment -> merchant roles | `employee_store_roles` | Employee Details / Roles |
| Merchant role -> permissions | `role_permissions` | Merchant Details / Roles & Permissions |

The complete schema also enforces `stores -> merchants`, `stores -> store_types`, `employees -> merchants`, `roles -> merchants`, `roles -> role_templates`, `permissions -> features`, and `subscriptions -> merchants/plans` through foreign keys. Subscriptions have unique subscription codes, not unique merchant IDs, so a merchant can retain multiple historical subscription records.

`merchant_id` is added to the three tenant-spanning mappings (`subscription_stores`, `employee_stores`, `employee_store_roles`). Composite foreign keys require both parents to belong to that same merchant. A store belonging to merchant B cannot consume merchant A's subscription, receive merchant A's employee, or use merchant A's role. Parent ownership changes are also blocked while those mappings exist. Applications must supply this field when creating assignments.

Each documented relationship pair is unique. Foreign keys reject orphan references and prevent deleting referenced parents. Effective end dates must follow start dates; deactivation cannot precede activation. Canonical feature types are `BOOLEAN`, `LIMIT`, and `CONFIG`, and role scope is `MERCHANT` or `STORE`. Status defaults use the application's uppercase convention. The complete schema also includes plan currency and nonnegative price/license-count checks.

## Existing application compatibility

The additive migration deliberately preserves the existing parent records and columns. It does not convert text IDs such as `MCH-*`, `STR-*`, or `SUB-*` to UUIDs, rename columns, remove old constraints, or change the TypeORM entities.

The existing application still differs from the canonical document in several ways:

- `stores.store_type_id` currently holds a store-type **code** rather than the UUID `store_types.id` reference used by the document.
- `subscriptions` currently uses `"planCode"` and inline JSON entitlements rather than the canonical `plan_id` relationship. Those values are not automatically translated into grants in the new tables.
- The current subscription entity makes `"merchantId"` unique and updates an existing subscription. Supporting the document's full subscription history requires an application and data migration together.
- Current feature values include `FLAG`/`TEXT`; the canonical schema uses the document's `BOOLEAN`/`LIMIT`/`CONFIG` vocabulary.

These parent-model changes require a separate backfill and matching application changes before adopting the complete UUID schema for existing data. Use the additive file for the missing mappings. Do not run the complete schema over the existing application database. Keep TypeORM automatic synchronization disabled when managing the database with reviewed SQL migrations, so it does not undo manually managed parent constraints.

## Access resolution remains server-side

These tables store the relationships; creating a row does not itself implement authorization. Per document sections 7 and 14, the service must intersect store licensing, store-type relevance, plan entitlements, subscription overrides, store overrides, active employee assignments and role permissions. A store-type default or a role permission cannot grant an unlicensed feature. Store overrides must not bypass the subscription entitlement gate. Time windows and record status must be checked at request time.

The DDL does not infer a devices, billing, audit-history or plan-version schema from UI tab names: the document does not define their table structures. Existing application tables for those areas remain separate. Audit timestamp defaults populate inserts; application writes must maintain `updated_at`.

## Validation

Run against a disposable PostgreSQL database:

```powershell
$env:PCH_SCHEMA_TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@localhost:PORT/DATABASE'
node scripts/master-data-schema.test.cjs
```

The test creates and removes randomly named schemas. It checks the complete schema and the additive migration with UUID parents, text-ID parents with snake_case ownership, and text-ID parents with camelCase ownership. Coverage includes repeated migration, all ten relationship tables, valid mappings, duplicate and orphan rejection, cross-tenant links, parent ownership changes/deletion, subscription history and invalid effective periods.

To apply the appropriate SQL file to a selected database, use `psql` with `-v ON_ERROR_STOP=1 -f <file>`. Confirm the parent schema matches the applicable path above first.
