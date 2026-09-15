# Permissions API

The merchant service already implements permissions in `apps/merchant-service/src/permission.controller.ts` and registers the controller in `app.module.ts`.

Import `docs/postman/PCH - master apis.postman_collection.json`. The **04 - Existing APIs Missing From Original Collection → Permissions** folder contains 8 requests. Its default `masterBaseUrl` is `http://localhost:3003/api/v1`.

| Action | Method and path |
| --- | --- |
| List | `GET /permissions` |
| Filter by feature and/or status | `GET /permissions?featureId={featureId}&status=ACTIVE` |
| Get by UUID or permission key | `GET /permissions/{idOrKey}` |
| Create | `POST /permissions` |
| Update supplied fields | `PUT /permissions/{idOrKey}` |
| Change status | `PUT /permissions/{idOrKey}` with `{"status":"ACTIVE"}` or `{"status":"INACTIVE"}` |
| Deactivate, retaining the record | `DELETE /permissions/{idOrKey}` |

Create requires `featureId` (feature UUID), `permissionKey` (maximum 100 characters), and `name` (maximum 150 characters). `description` and `status` are optional; status defaults to `ACTIVE`. Duplicate keys return 409. Keys are normalized to uppercase. Update accepts `featureId`, `name`, `description`, and `status`; the key cannot be edited. Missing detail/update/delete targets return 404.

List returns `{ success, count, permissions }`, sorted by name. Without a status filter, inactive records are included. Detail returns `{ success, permission }`. Set `featureId` to the desired feature and copy a permission ID from a list/create response into `permissionId`. `permissionKey` defaults to the example `VIEW_REFUND`.

Relationship: **Feature → Permissions** through each permission's `featureId`. The web Permissions screen can load a selected feature's actions using the feature filter. The screen is not connected by this collection update.

There is no permission PATCH route or separate `/status` route; use PUT. Read-only verification against the local service returned HTTP 200 for list and active-filter requests. No permission records were created or changed during verification.

