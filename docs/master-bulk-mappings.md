# Bulk-create Master Setup mappings

Use an authenticated OWNER session. Each endpoint accepts `{ "items": [...] }` with 1–100 objects using the same fields as its existing single-create endpoint.

| Endpoint (POST) | Item ID field |
| --- | --- |
| `/api/v1/store-types/{storeTypeId}/features/bulk` | `featureId` |
| `/api/v1/store-types/{storeTypeId}/role-templates/bulk` | `roleTemplateId` |
| `/api/v1/plans/{planId}/entitlements/bulk` | `featureId` |

Store-type features example (replace IDs with existing UUIDs):

```json
{
  "items": [
    { "featureId": "11111111-1111-4111-8111-111111111111", "defaultEnabled": true, "required": false, "displayOrder": 1, "configurationJson": { "showInPos": true } },
    { "featureId": "22222222-2222-4222-8222-222222222222", "defaultEnabled": true, "required": false, "displayOrder": 2 }
  ]
}
```

Role-template items use `roleTemplateId`, `defaultEnabled`, and `required`. Plan-entitlement items use `featureId`, `enabled`, optional nullable string `limitValue`, and optional `configurationJson`.

Success: HTTP 201 with `{ "success": true, "count": 2, "items": [...] }`; items are the saved mapping records in input order. Every batch runs in one database transaction. Invalid input returns 400; missing parent/child returns 404; an existing mapping returns 409. No records from a failed batch remain saved. Duplicate child IDs within the same batch return 400, including UUIDs differing only in letter case. Existing mappings are not replaced or skipped.

No schema migration is needed beyond the existing relationship tables. Single-create APIs remain available. Bulk APIs for merchant subscription/store overrides are outside this Master Setup change.

Run `node --import tsx scripts/master-bulk-routes.test.ts` for isolated HTTP/repository tests and `node --import tsx scripts/relationships-api.test.ts` for PostgreSQL integration tests (fixtures are rolled back).
