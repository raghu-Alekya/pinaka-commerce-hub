# Role templates and plans master APIs

Base URL: `http://localhost:3003/api/v1` (merchant-service).

| Action | Method | Role templates | Plans |
| --- | --- | --- | --- |
| Create | POST | `/role-templates` | `/plans` |
| Get all | GET | `/role-templates` | `/plans` |
| Get by UUID | GET | `/role-templates/:id` | `/plans/:id` |
| Replace | PUT | `/role-templates/:id` | `/plans/:id` |
| Partial update | PATCH | `/role-templates/:id` | `/plans/:id` |
| Delete | DELETE | `/role-templates/:id` | `/plans/:id` |

`/role_templates` is also supported as an alias. Send `Content-Type: application/json` for request bodies.

Role template create/replace:
```json
{"roleCode":"STORE_MANAGER","name":"Store Manager","description":"Store management role","scopeType":"STORE","status":"ACTIVE"}
```
Required: roleCode (up to 50 characters), name (up to 100). scopeType accepts MERCHANT/STORE and defaults to STORE.

Plan create/replace:
```json
{"planCode":"STANDARD","name":"Standard","description":"Standard package","billingModel":"FLAT","basePrice":49.99,"currency":"INR","billingCycle":"MONTHLY","status":"ACTIVE"}
```
Required: planCode (up to 50 characters), name (up to 100), billingModel, basePrice, currency, billingCycle. billingModel accepts FLAT/PER_STORE/PER_DEVICE/CUSTOM; billingCycle accepts MONTHLY/ANNUAL. basePrice must be a nonnegative JSON number with at most two decimal places and a maximum of 9999999999.99. Currency is normalized to three uppercase letters. PostgreSQL returns basePrice as a decimal string to preserve precision.

For both resources, description defaults to an empty string and status to ACTIVE (ACTIVE/INACTIVE allowed). Codes are unique and case sensitive. PUT requires all required fields and resets omitted optional fields to defaults. PATCH preserves omitted fields and rejects an empty body. A status change can use PATCH with `{"status":"INACTIVE"}`.

Create returns 201; other successful requests return 200. Single record responses contain `success` plus `roleTemplate` or `plan`. Lists contain `success`, `count`, and `roleTemplates` or `plans`. IDs and timestamps are server generated.

Errors: 400 invalid input/UUID; 404 record missing; 409 duplicate code or referenced record deletion; 503 unavailable database/schema. Referenced records can be set INACTIVE instead of deleted.

Storage: public.role_templates and public.plans. Existing subscription-plans APIs continue using their separate subscription_plans table. For a fresh database apply docs/role-templates-plans.sql; service writes maintain updated_at. No sample records are seeded.

Verification: `node --import tsx scripts/master-data-api.test.ts` tests all four master APIs against the local PostgreSQL database and rolls back test records.
