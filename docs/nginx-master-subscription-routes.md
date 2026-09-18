# Nginx routes for master data and subscriptions

Deploy `nginx/pch.alektasolutions.com.conf` for `pch.alektasolutions.com`. It proxies the following paths to the merchant service at `127.0.0.1:3003`.

Use Postman collection variable `masterBaseUrl = https://pch.alektasolutions.com/connector/api/v1`. Supply the normal bearer access token; relationship APIs require an OWNER account.

| Path after the base URL | Purpose |
| --- | --- |
| `/store-types` | Store type CRUD |
| `/features` | Feature CRUD |
| `/role-templates` | Role template CRUD |
| `/plans` | Plan CRUD |
| `/store-types/:storeTypeId/features` | Store type feature mappings |
| `/store-types/:storeTypeId/role-templates` | Store type role template mappings |
| `/plans/:planId/entitlements` | Plan entitlements |
| `/subscriptions` | Create and list subscriptions |
| `/subscriptions?merchantId=:merchantId` | Merchant subscription history |
| `/subscriptions/:subscriptionId` | Get, replace, patch or delete a subscription |
| `/merchants/:merchantId/subscriptions/:subscriptionId/stores` | Subscription store mappings |
| `/merchants/:merchantId/subscriptions/:subscriptionId/entitlements` | Subscription entitlement overrides |
| `/merchants/:merchantId/stores/:storeId/entitlements` | Store entitlement overrides |

Mapping paths also accept the related entity ID as a final path segment for GET, PUT, PATCH and DELETE. Cancellation uses PATCH on the subscription ID URL with `{"status":"CANCELLED"}`; there is no separate cancel route.

The same merchant-service routes are available directly under `https://pch.alektasolutions.com/api/v1`. The connector form removes only `/connector` before proxying. Request methods, bodies, authorization headers and query parameters are forwarded. Existing parent locations cover nested mappings; separate Nginx locations for each mapping are unnecessary.

## Apply on the server

Copy the configuration into the existing enabled PCH site file, preserving a backup first. Do not enable a second server block for the same domain. The configuration assumes the existing Let's Encrypt certificate files and frontend directory `/var/www/pch`.

After installing the configuration:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Run the reload only if the syntax check succeeds. Check a read-only endpoint using your current token:

```sh
curl --fail-with-body 'https://pch.alektasolutions.com/connector/api/v1/subscriptions?merchantId=MCH-1001' \
  --header "Authorization: Bearer $ACCESS_TOKEN"
```

Creating, cancelling and deleting subscriptions remain application operations; Nginx does not change their validation or database behavior.
