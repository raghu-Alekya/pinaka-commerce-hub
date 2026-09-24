# Device APIs

Served by merchant-service on port 3003. React uses the existing `/api/v1` proxy.

- `POST /api/v1/devices`: creates a device; returns HTTP 201 with `{ success, device }`.
- `GET /api/v1/devices`: returns `{ count, devices }`, newest first, with merchant/store names. Image data is excluded from the list.
- `GET /api/v1/devices/:deviceId`: returns one device.
- `PUT` or `PATCH /api/v1/devices/:deviceId`: updates a device. `storeId` may be omitted.
- `DELETE /api/v1/devices/:deviceId`: deletes a device.

Example create body:

```json
{
  "deviceName": "POS Terminal 01",
  "deviceType": "POS Terminal",
  "serialNumber": "SN1234567890",
  "merchantId": "MCH-1001",
  "status": "Active",
  "timeZone": "Asia/Kolkata",
  "enableImmediately": true
}
```

Use an existing merchant ID. Required fields are deviceName, deviceType, serialNumber and merchantId. A device can be created without a store; if `storeId` is supplied, it must identify a store belonging to the selected merchant. Updates do not require `storeId` and preserve any existing store association unless a store ID is explicitly supplied. Supported types: POS Terminal, Kitchen Display, Barcode Scanner, Receipt Printer, Customer Display.

Optional fields: macAddress, model, manufacturer, status (Active/Inactive), timeZone (IANA identifier), location, floor, notes (500 characters), enableImmediately and image (JPG/PNG data URL, maximum decoded size 2MB). Serial numbers are trimmed, uppercased and globally unique. Inactive status or enableImmediately=false disables the device. New enabled devices are Offline with no last-seen timestamp; heartbeat tracking is outside these endpoints.

Validation/assignment failures return 400, missing merchant or explicitly supplied store 404, duplicate serial 409 and unavailable database 503. Devices require PostgreSQL and are never saved to the merchant service's temporary memory fallback.

Apply schema with `node scripts/setup-merchant-db.cjs`, then restart merchant-service. React `/devices/add` creates devices; `/devices` lists, searches, filters and paginates them.

Tests: `node --import tsx scripts/device-routes.test.ts` and `node --import tsx scripts/device-db.test.ts`. The database test rolls back all test records.
