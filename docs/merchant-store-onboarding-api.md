# Merchant and store onboarding

All endpoints require the existing authenticated merchant-service session.

## Two-stage merchant onboarding

- `POST /api/v1/merchants/onboarding`: create merchant and pending subscription. Stores may be omitted or empty.
- `PUT /api/v1/merchants/:id/onboarding`: update contact information and optionally subscription and stores. Merchant code is immutable. Omitted stores remain unchanged; this does not delete stores.
- `GET /api/v1/merchants/:id/onboarding`: retrieve screen-shaped contact information, subscription, and store setup.

```json
{
  "merchant": {
    "code": "MER-4001", "business": "Example Retail LLC", "display": "Example Retail",
    "name": "Example Owner", "email": "owner@example.com", "phone": "+15555550123",
    "country": "United States", "city": "Phoenix", "state": "Arizona",
    "address": "100 Example Street", "postal": "85001"
  },
  "subscription": {
    "planCode": "STARTER", "billingCycle": "MONTHLY", "startDate": "2026-09-16",
    "licensedStoreCount": 1, "licensedDeviceCount": 3
  },
  "stores": []
}
```

Use the existing `POST /api/v1/ids/merchant` and `/ids/store` for codes. Send the active master plan code, not the screen's numeric plan-array index. Pricing and entitlements come from the commercial plan; client payment history, card/ACH data, status and price overrides are not accepted. New subscriptions and stores remain pending; this flow does not collect payment or activate services. License counts are the requested/agreed setup capacity, not a payment receipt.

The response contains `{success, merchant, stores, subscription}`. All database writes, including the audit entry, succeed or roll back together. Unknown fields, invalid nested data, inactive master choices and capacity violations return 400; missing merchants return 404; duplicate codes/emails and cross-merchant stores return 409. Existing endpoints remain available for older clients.

## Store setup

Existing create/update endpoints accept these additional optional fields:

- `country`: store country, independent of the merchant address.
- `hours`: exactly seven distinct days; `{day, status, open, close, shifts}`. Status is `Open`, `Closed`, `24 hours`, or empty while unconfigured. Open days require distinct valid `HH:mm` opening/closing times; overnight hours are allowed.
- `logo`: logo URL or image data used by the screen.
- `licensed`: requested store license selection.
- `devices`: setup selections with `name`, `type` (`POS`, `KDS`, `Printer`, `Scanner`), and unique `serial`.
- `features`: selected feature names/keys.
- `roles`: setup selections with `name`, `scope` (`Store` or `Merchant`) and permission configuration.

Store identity/location fields retain the existing contract: `merchantId`, `storeId`, `name`, `type`, `phone`, `url`, `currency`, `status`, `address`, `city`, `state`, `zip`, `timezone`. In the merchant onboarding request, each store uses this same contract. The store's `type` must be an active store-type master code.

Store setup is persisted in `stores.onboardingSetup`, returned in ordinary store detail responses, and flattened by the onboarding GET endpoint. Omitted setup fields on update are preserved; explicit empty arrays clear selections. Device, feature and role selections are **configuration drafts**; use the existing device-registration and permission/entitlement APIs to provision effective access. This endpoint never grants access from browser-supplied permission selections.

## Screen integration

The current merchant page still calls its browser-local `onSave` handler. Connect that handler to these endpoints before claiming server persistence. Map its `merchant` object directly; map plan selection to `subscription.planCode`, `cycle` to `billingCycle`, and `start` to `startDate`. Store `code` maps to `storeId`, `postal` to `zip`. Convert feature indices to stable names/keys and group device selections by their store code.

The standalone store page must include its separate `devices`, `enabledFeatures`, and `roles` state plus `hours` in the request; the existing adapter currently omits some of these fields. Backend support alone does not fix that client omission.

Startup applies the additive schema extension. For managed deployments with schema changes applied separately, run `docs/sql/08_store_onboarding_setup.sql` first.
