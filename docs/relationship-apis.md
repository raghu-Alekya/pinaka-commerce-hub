# Store-type mappings and commercial relationships

These APIs implement the missing relationship sections in the supplied image. Existing merchant, store, employee, feature, permission, role-template, role, plan, subscription and subscription-plan APIs are unchanged.

Local base URL: `http://localhost:3003`. All new routes require a valid bearer session for an `OWNER`. They use the existing session guard and an additional owner check. Merchant IDs in URLs define the data scope; the parent and any linked store must belong to that merchant. These are administration APIs, not employee-facing authorization APIs.

## Endpoints

Each collection supports `GET` (list) and `POST` (create). Append the **related record ID** shown below for `GET`, `PUT`, `PATCH`, and `DELETE`. The relationship row's own `id` is returned for reference and is not the URL identifier.

| Collection path | Related ID | POST body identifier |
| --- | --- | --- |
| `/api/v1/store-types/:storeTypeId/features` | Feature UUID | `featureId` |
| `/api/v1/store-types/:storeTypeId/role-templates` | Role-template UUID | `roleTemplateId` |
| `/api/v1/plans/:planId/entitlements` | Feature UUID | `featureId` |
| `/api/v1/merchants/:merchantId/subscriptions/:subscriptionId/stores` | Store ID | `storeId` |
| `/api/v1/merchants/:merchantId/subscriptions/:subscriptionId/entitlements` | Feature UUID | `featureId` |
| `/api/v1/merchants/:merchantId/stores/:storeId/entitlements` | Feature UUID | `featureId` |

`storeTypeId` and `planId` are UUIDs from the existing master APIs. Merchant, store and subscription IDs retain the application's current text format, such as `MCH-1001`, `STR-5001`, and `SUB-...`. New routes do not introduce aliases or shadow existing endpoints.

## Request fields

| Relationship | Mutable fields and defaults |
| --- | --- |
| Store-type feature | `defaultEnabled: false`, `required: false`, `displayOrder: null`, `configurationJson: null` |
| Store-type role template | `defaultEnabled: false`, `required: false` |
| Plan entitlement | `enabled: false`, `limitValue: null`, `configurationJson: null` |
| Subscription store | `status: "ACTIVE"`, `activatedAt: null`, `deactivatedAt: null` |
| Subscription/store entitlement | `enabled: false`, `limitValue: null`, `source: null`, `effectiveFrom: null`, `effectiveUntil: null` |

POST requires the related ID and accepts the mutable fields. A duplicate mapping returns 409. PUT replaces all mutable fields, resetting omitted fields to the defaults above; it requires an existing relationship. PATCH changes only supplied fields and rejects an empty object. Parent IDs, related IDs, row IDs and timestamps cannot be edited. DELETE removes the mapping, never either parent. Deleting a subscription-store mapping removes its license association; use `status: "INACTIVE"` when retaining that record is preferable.

Booleans must be JSON booleans. `displayOrder` must be a nonnegative 32-bit integer. `configurationJson` must be a JSON object or null. `limitValue` and `source` are strings of at most 100 characters or null. `limitValue` can represent a numeric limit or an explicit value such as `Unlimited`; the API does not interpret commercial limits. Subscription-store status accepts `ACTIVE`, `INACTIVE`, or `SUSPENDED`.

Dates must be valid ISO 8601 timestamps with a timezone, for example `2026-10-01T00:00:00Z`. Nullable fields can be cleared with null. Effective end must follow effective start; deactivation cannot precede activation. A PATCH is validated against the saved values as well as the changed values. Unknown fields and invalid types return 400.

## Examples

Create a store-type feature:

```http
POST /api/v1/store-types/<store-type-uuid>/features
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "featureId": "<feature-uuid>",
  "defaultEnabled": true,
  "required": false,
  "displayOrder": 1,
  "configurationJson": { "showInPos": true }
}
```

Create a role-template mapping:

```json
{ "roleTemplateId": "<role-template-uuid>", "defaultEnabled": true, "required": false }
```

Create a plan entitlement:

```json
{ "featureId": "<feature-uuid>", "enabled": true, "limitValue": "5", "configurationJson": {} }
```

License a store under its merchant's subscription:

```http
POST /api/v1/merchants/MCH-1001/subscriptions/<subscription-id>/stores
Authorization: Bearer <access-token>
Content-Type: application/json

{ "storeId": "STR-5001", "status": "ACTIVE", "activatedAt": "2026-10-01T00:00:00Z" }
```

Create a subscription or store override using its corresponding collection path:

```json
{
  "featureId": "<feature-uuid>",
  "enabled": true,
  "limitValue": "8",
  "source": "NEGOTIATED_ADDON",
  "effectiveFrom": "2026-10-01T00:00:00Z",
  "effectiveUntil": "2027-10-01T00:00:00Z"
}
```

Disable an existing override:

```http
PATCH /api/v1/merchants/MCH-1001/stores/STR-5001/entitlements/<feature-uuid>
Authorization: Bearer <access-token>
Content-Type: application/json

{ "enabled": false }
```

## Responses and compatibility

- List: `{ "success": true, "count": 0, "items": [] }`.
- Create/read/update: `{ "success": true, "item": { ... } }`, with camelCase field names and ISO timestamps.
- Delete: `{ "success": true, "message": "Relationship removed" }`.
- Status: 201 on create, 200 on successful reads/updates/deletes, 400 for invalid input, 401 for invalid/missing sessions, 403 for non-owner users, 404 for missing or out-of-scope parents/children/mappings, 409 for duplicate or conflicting references, 503 for a missing relationship schema.

The APIs require `docs/sql/03_master_data_relationships.sql` and the current application parent schema (`subscriptions."merchantId"`, `stores.merchant_id`, text subscription/store IDs). No additional migration is needed for the configured local database. They do not automatically migrate a server database with a different schema.

The existing `/api/v1/subscriptions` and `/api/v1/subscription-plans` behavior remains intact. `plans` is the commercial master used by the new plan-entitlement API; existing subscriptions still store `planCode` and inline entitlement JSON. These new APIs persist relational configuration; they do not replace that old contract, infer a new `plan_id`, enforce purchased store counts, or implement effective-feature/access evaluation. Those changes would require modifying existing behavior and are intentionally separate from this additive request.

## Verification

`node --import tsx scripts/relationships-api.test.ts` runs 202 assertions against PostgreSQL using an outer transaction. Fixtures and API writes are rolled back. Tests cover all six route groups, CRUD, defaults/replacement, patch preservation, invalid inputs, duplicate/orphan mappings, effective periods, owner access and cross-merchant rejection.
