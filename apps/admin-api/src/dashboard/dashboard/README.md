# Dashboard API status

Only the Features and Platform Health endpoints currently have data providers. Other dashboard sections remain scaffolds. Unsupported Platform Health metrics are returned as `null` with an explicit status and reason; no values are fabricated.

## Existing data sources to integrate

`admin-api` does not query another application's database. Dashboard data is read through merchant-service HTTP endpoints; the service-owned sources are:

- Summary and administration overview: `MerchantEntity`, `StoreEntity`, `EmployeeEntity`, and `SubscriptionEntity` in `apps/merchant-service/src/entities`; merchant/store operations also live in `apps/merchant-service/src/modules/merchant` and `apps/merchant-service/src/modules/store`.
- Platform health: the merchant-service read API aggregates `DeviceEntity` by its existing `RecordStatus`, uses the existing `WebsiteConnectionEntity` status as the dashboard's requested store-synchronized definition, and counts stores with all nine documented POS configuration categories. The device metric is temporarily Active/Inactive, not verified online connectivity. Website `CONNECTED` means the website connection status is connected; it does not verify sync job freshness/success. POS completion checks that every category has a saved `store_pos_configurations` row; it does not validate each field's content. No overall score is calculated because no formula is agreed.
- Features: `FeatureEntity` and `PlanEntity` are read by the existing merchant-service APIs. `FeatureEntity.status` defines active/inactive, its soft-deleted records are excluded, and plan inclusion is stored as feature codes in `PlanEntity.includedFeatures`.
- Plans and entitlements: `PlanEntity` and `SubscriptionEntity` are candidate sources. Store capacity, terminal limits, and warning thresholds need agreed definitions.
- Roles and permissions: `RoleEntity`, `RoleTemplateEntity`, `PermissionEntity`, and `EmployeeStoreRoleEntity` are candidate sources. The scope for system versus custom roles and employee assignments needs an agreed service contract.

These entity names identify likely sources only. `admin-api` must not import or query another application's database directly. Add an authenticated service client or a dedicated read API after the owning services define their contracts.

## Routes

- `GET /api/v1/admin/dashboard/summary`
- `GET /api/v1/admin/dashboard/platform-health`
- `GET /api/v1/admin/dashboard/features`
- `GET /api/v1/admin/dashboard/plans-entitlements`
- `GET /api/v1/admin/dashboard/administration-overview`
- `GET /api/v1/admin/dashboard/roles-permissions`

All routes accept optional `merchant_id`, `store_id`, `from_date`, and `to_date` query parameters. Dashboard response field names use snake_case. Features calls `GET /api/v1/features` and `GET /api/v1/plans` on `MERCHANT_SERVICE_URL` (default `http://localhost:3003`); the plan list includes enabled feature IDs from the existing `plan_entitlements` relationship, alongside legacy `included_features`. It counts only active, non-deleted plans, matching the plan API's status rule and soft-delete behavior. Feature IDs, codes, and names are matched case-insensitively and deduplicated by feature code. Inactive plans and disabled plan-entitlement rows do not qualify. Counts reconcile as `included + not included = total`.

Platform Health calls `GET /api/v1/dashboard/platform-health/source-metrics` on merchant-service (default `http://localhost:3003`) and forwards the incoming bearer token. Active devices and active stores are filtered to non-deleted records and can be filtered by merchant/store. For this dashboard, store synchronization means the count of eligible stores whose existing website connection row is `CONNECTED`; it does not indicate successful or recent data sync. POS completion means all nine documented configuration category rows exist for an eligible store. No separate integrations metric is returned. `online_count` and the overall score remain `null`; the device active percentage is explicitly not a connectivity percentage.

Configure `MERCHANT_SERVICE_URL` in the `admin-api` environment when the merchant service is not reachable at `localhost:3003`. The Features endpoint returns HTTP 503 if either upstream read API is unavailable or returns an invalid payload.

The existing `admin-api` does not configure an authentication guard. The Features route forwards any incoming `Authorization` header to the protected merchant-service plans read; supply a valid bearer token so that upstream request succeeds. The dashboard route itself does not validate that token, so access control at `admin-api` still needs to be established before exposing it beyond trusted internal use.
