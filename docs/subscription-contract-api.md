# Subscription contracts

`subscriptions` now follows the document's Merchant -> Subscription -> Plan chain. `plan_id` references **public.plans.id**, the same plan master used by `/api/v1/plans/:planId/entitlements`. Subscription creation no longer looks up a different `subscription_plans` record.

## Request example

```http
POST http://localhost:3003/api/v1/subscriptions
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "merchantId": "MCH-1001",
  "subscriptionCode": "SUB-PRO-2026-001",
  "planId": "b1111111-0000-0000-0000-000000000002",
  "status": "ACTIVE",
  "billingCycle": "MONTHLY",
  "startDate": "2026-10-01",
  "renewalDate": "2026-11-01",
  "trialEndDate": null,
  "licensedStoreCount": 5,
  "licensedDeviceCount": 15,
  "price": 79,
  "currency": "USD"
}
```

Required on POST: `merchantId` and `planId`. Optional `id` retains the application's text ID format; otherwise a `SUB-<uuid>` ID is generated. `subscriptionCode` defaults to that ID and is unique. The plan must exist and be ACTIVE. The seeded UUID format is accepted.

| API field | Database column |
| --- | --- |
| id | id (existing varchar identifiers preserved) |
| subscriptionCode | subscription_code |
| merchantId | merchant_id, FK to merchants.id |
| planId | plan_id, FK to plans.id |
| status | status |
| billingCycle | billing_cycle |
| startDate | start_date |
| renewalDate | renewal_date |
| trialEndDate | trial_end_date |
| licensedStoreCount | licensed_store_count |
| licensedDeviceCount | licensed_device_count |
| price | price |
| currency | currency |
| cancelledAt | cancelled_at |
| createdAt / updatedAt | created_at / updated_at |

Dates use `YYYY-MM-DD`; end must follow start, and trial end cannot precede start. Dates and licensed counts accept null. Counts are nonnegative integers. Null means no explicit numeric contract count is stored; it does not grant unlimited access by itself. Price is a nonnegative number with at most two decimal places, including zero. Currency is three uppercase letters.

Status accepts `PENDING`, `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, and `EXPIRED`. Billing cycle accepts `MONTHLY`, `ANNUAL`, and legacy `FREE_TRIAL`. Initial status defaults to ACTIVE. Price, currency and billing cycle default from the commercial plan unless explicitly supplied as negotiated contract terms. Counts default from enabled `MAX_STORES` / `MAX_DEVICES` plan-entitlement numeric limits; absent or nonnumeric values leave them null. Cancellation timestamps and audit timestamps are server-managed.

## Routes and history

- `GET /api/v1/subscriptions?merchantId=...`: list contracts, including historical records. Current ACTIVE/TRIAL/PAST_DUE contracts are listed first; within each group the newest record is first.
- `GET /api/v1/subscriptions/:id`: retrieve one contract.
- `POST /api/v1/subscriptions`: create a separate contract. Multiple subscriptions for the same merchant are allowed; subscription codes and IDs must remain unique.
- `PATCH /api/v1/subscriptions/:id`: update supplied fields only. Empty patches, immutable IDs/merchant ownership, malformed fields, and conflicting aliases return 400.
- `PUT /api/v1/subscriptions/:id`: replace the mutable contract. Requires planId (or legacy planCode), status, billingCycle and price. Omitted dates/counts reset to defaults; ID, merchant, subscription code (unless explicitly changed) and creation timestamp remain intact.
- `PATCH /api/v1/subscriptions/:id` with `{"status":"CANCELLED"}`: retain the contract and set cancelledAt. This is the recommended way to keep subscription history.
- `DELETE /api/v1/subscriptions/:id`: retains existing hard-delete behavior only for unreferenced records. Linked subscription-store or entitlement records produce 409 rather than being silently deleted. Use cancellation for historical contracts.

These routes retain the existing session authentication policy. POST returns 201; other successful operations return 200. Responses retain `{success, subscription}` or `{success, count, subscriptions}`. Missing subscriptions/merchants return 404; duplicate codes return 409; invalid/inactive plans return 400.

## Compatibility

Old onboarding payloads can use `planCode`, `maxStoresAllowed`, `currentPeriodStart` and `currentPeriodEnd`. Codes are resolved against **plans**, and aliases map to the corresponding contract fields. Conflicting canonical/legacy values are rejected. The legacy `planName`, `entitlements`, `trialDays`, `maxStoresAllowed` and period columns remain for existing consumers. Name and inline feature keys are derived from the selected commercial plan; clients should edit relationships through the entitlement APIs rather than treating the snapshot fields as an independent plan catalog. The default inline feature-key snapshot uses enabled plan-entitlement rows and does not implement subscription/store override resolution.

Onboarding's create-or-update helper updates the newest current contract. If only cancelled/expired historical contracts exist, it creates a new contract instead of overwriting history. The standalone subscription API always creates a new row on POST. Multiple current contracts are permitted; this change does not automatically close or cancel other contracts.

Migration `docs/sql/05_align_subscriptions.sql` renames four old columns, adds/backfills the contract fields, removes merchant-only uniqueness, and installs foreign keys and a compatibility trigger for legacy inserts/updates. It aborts if a legacy planCode cannot be resolved to an existing commercial plan. Existing text IDs, monetary values, snapshots, dates, and child relationship references are retained. A local database backup was made before applying it. Automatic synchronization remains disabled.

The relationship APIs now scope subscriptions through `merchant_id`; deploy migration 05 together with this code. Run migration 03 first if the relationship tables are not yet installed. The canonical UUID new-install schema is still separate from this migration of the existing application.

The plan FK and contract data are implemented; automatic license-count enforcement and effective entitlement/permission evaluation are separate runtime work. Contract creation does not automatically license stores; create subscription-store mappings explicitly.

## Validation

`node --import tsx scripts/subscription-contract-api.test.ts` checks actual PostgreSQL and HTTP behavior in a rollback-only transaction, including plan selection, all contract fields, validation, defaults, multiple subscriptions, cancellation, onboarding history, legacy aliases and deletion conflicts. `scripts/relationships-api.test.ts` verifies the relationship APIs against the renamed owner column.
