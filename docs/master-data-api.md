# Store types and features CRUD

These admin catalog APIs run in merchant-service at `http://localhost:3003`.
They persist to `public.store_types` and `public.features` using the configured PostgreSQL connection. If the tables are missing, apply `docs/store-types-features.sql` to that database. No sample catalog records are inserted.

| Resource | Collection endpoint | Single record endpoint |
| --- | --- | --- |
| Store types | `/api/v1/store-types` (also `/api/v1/store_types`) | `/api/v1/store-types/:id` |
| Features | `/api/v1/features` | `/api/v1/features/:id` |

Both support GET list, GET by UUID, POST create, PUT replace, PATCH partial update, and DELETE. Create returns 201; other successful operations return 200. Responses include `success` and `storeType`/`feature`, or `count` and `storeTypes`/`features` for lists.

Store type POST / PUT body:
```json
{"storeTypeCode":"RESTAURANT","name":"Restaurant","description":"Restaurant stores","status":"ACTIVE"}
```

Feature POST / PUT body:
```json
{"featureKey":"POS","name":"Point of sale","category":"Operations","featureType":"BOOLEAN","description":"POS capability","status":"ACTIVE"}
```

Required fields: storeTypeCode + name for store types; featureKey + name + category for features. Optional description defaults to an empty string, status to ACTIVE, and featureType to TEXT. PUT restores these defaults when omitted. PATCH preserves omitted values and requires at least one field. IDs and timestamps are server managed. Codes and keys are case sensitive and unique. Status accepts ACTIVE/INACTIVE; featureType accepts BOOLEAN/LIMIT/CONFIG/TEXT.

Errors: 400 invalid fields/UUID or empty PATCH; 404 missing record; 409 duplicate code/key or foreign-key-protected deletion; 503 database/schema unavailable. For referenced records, set status to INACTIVE. These catalogs do not grant permissions or commercial entitlements.

Run the integration test against a local database with these tables installed:
```powershell
node --import tsx scripts/master-data-api.test.ts
```
Test records are rolled back. Start the service using the existing local launcher or `node --import tsx apps/merchant-service/src/main.ts`.
`nStatus-only updates: PUT or PATCH `/api/v1/store-types/:id/status` and `/api/v1/features/:id/status` with `{"status":"ACTIVE"}` or `{"status":"INACTIVE"}`. Other fields and missing/invalid statuses return 400.
