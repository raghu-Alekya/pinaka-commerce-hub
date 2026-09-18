# Store types and features CRUD

These admin catalog APIs run in merchant-service at `http://localhost:3003`.
They persist to `public.store_types` and `public.features` using the configured PostgreSQL connection. If the tables are missing, apply `docs/store-types-features.sql` to that database. No sample catalog records are inserted.

| Resource | Collection endpoint | Single record endpoint |
| --- | --- | --- |
| Store types | `/api/v1/store-types` (also `/api/v1/store_types`) | `/api/v1/store-types/:id` |
| Features | `/api/v1/features` | `/api/v1/features/:id` |

Both support GET list, GET by UUID, POST create, PUT replace, PATCH partial update, and DELETE. Create returns 201; other successful operations return 200. Responses include `success` and `storeType`/`feature`, or `count` and `storeTypes`/`features` for lists.

### Feature categories

`GET /api/v1/features/categories` returns all distinct, trimmed, non-empty category names from existing features (including inactive features), sorted alphabetically. It uses the same session authentication and database error handling as the Features list. Categories are case-sensitive; no separate category records or IDs are created.

Example response: `{"success":true,"count":2,"categories":["Cash","Orders"]}`.
An empty catalog returns `{"success":true,"count":0,"categories":[]}`. Database/schema unavailability returns 503.

Run the HTTP regression checks with `node --import tsx scripts/feature-categories.test.ts`.

Store type POST / PUT body:
```json
{"storeTypeCode":"RESTAURANT","name":"Restaurant","description":"Restaurant stores","status":"ACTIVE"}
```

Feature POST / PUT body:
```json
{"featureKey":"POS","name":"Point of sale","category":"Operations","featureType":"BOOLEAN","description":"POS capability","status":"ACTIVE"}
```

Required fields: storeTypeCode + name for store types; featureKey + name + category for canonical feature requests. Optional description defaults to an empty string, status to ACTIVE, and featureType to TEXT. PATCH preserves omitted values. IDs and timestamps are server managed. Feature keys are case sensitive and unique; store type codes are normalized to uppercase. Status accepts ACTIVE/INACTIVE; featureType accepts BOOLEAN/LIMIT/CONFIG/TEXT.

## React Master Setup form compatibility

Permissions APIs are unchanged. Existing canonical request fields remain supported.

| Screen | Request fields accepted | Behavior |
| --- | --- | --- |
| Store Types / Overview | `code`, `name`, `description`, `status` | `code` maps to `storeTypeCode`; PUT/PATCH can update it. |
| Features | `name`, `description`, `category`, `type`, `status` | For screen requests containing `type`, `name` also supplies `featureKey` when no explicit key is sent. `type` maps to `featureType`. |
| Role Templates | `key`, `name`, `description`, `status` | `key` maps to `roleCode`; omitted scope defaults to STORE on create/replace. Duplicate using POST with a new unique key. |
| Plans | `code`, `name`, `description`, `billingModel`, `basePrice`, `billingCycle`, `status` | Also accepts list-row aliases `price` and `cycle`. Numeric prices may be strings. New plans default to INR, matching the rupee screen. PUT/PATCH preserve currency when omitted. |

Labels such as `Active`, `Inactive`, `Per store`, `Per device`, `Flat rate`, `Monthly`, `Quarterly`, and `Yearly` are normalized to API enums. Canonical responses continue to use uppercase enum values and canonical field names; UI date formatting and icons remain presentation concerns.

All four collection endpoints support `search` and `status`; Features also supports `category`, Plans supports `billingModel`. Counts describe filtered results. Empty status and `All Statuses` clear the status filter; `All Categories` clears category filtering.

Store Type Features uses `/api/v1/store-types/:storeTypeId/features`: GET list, POST assignment, POST `/bulk` with `{ "items": [...] }`, PATCH `/:featureId` for `defaultEnabled`, `required`, or `order` (alias of `displayOrder`), DELETE `/:featureId` to remove. Assignments require real feature UUIDs.

Store Type Role Templates uses `/api/v1/store-types/:storeTypeId/role-templates` with the same operations and `roleTemplateId` identifiers; flags are `defaultEnabled` and `required`. Create a global role template first using its unique key/name, then assign its UUID. Relationship responses use `items`/`item`; join with the feature/role catalog to display names, categories, and scope. Existing owner authorization remains enforced.

Before using Quarterly plans in an existing database, apply `docs/sql/06_master_setup_quarterly.sql`. New schema scripts include Quarterly. Restart merchant-service after deploying these changes. These backend changes do not replace the React screens' local mock CRUD with network calls.

Errors: 400 invalid fields/UUID or empty PATCH; 404 missing record; 409 duplicate code/key or foreign-key-protected deletion; 503 database/schema unavailable. For referenced records, set status to INACTIVE. These catalogs do not grant permissions or commercial entitlements.

Run the integration test against a local database with these tables installed:
```powershell
node --import tsx scripts/master-data-api.test.ts
```
Test records are rolled back. Start the service using the existing local launcher or `node --import tsx apps/merchant-service/src/main.ts`.
`nStatus-only updates: PUT or PATCH `/api/v1/store-types/:id/status` and `/api/v1/features/:id/status` with `{"status":"ACTIVE"}` or `{"status":"INACTIVE"}`. Other fields and missing/invalid statuses return 400.
