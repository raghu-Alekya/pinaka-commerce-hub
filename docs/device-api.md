# Device APIs

Served by merchant-service on port 3003. React uses the existing `/api/v1` proxy.

- `POST /api/v1/devices`: creates a device; returns HTTP 201 with `{ success, device }`.
- `GET /api/v1/devices`: returns `{ count, devices }`, newest first, with merchant names.
- `GET /api/v1/devices/merchant/:merchantId`: returns all devices for one merchant, newest first.
- `GET /api/v1/devices/:deviceId`: returns one device.
- `PUT` or `PATCH /api/v1/devices/:deviceId`: updates a device.
- `DELETE /api/v1/devices/:deviceId`: deletes a device.

Example create body:

```json
{
  "deviceName": "POS Terminal 01",
  "deviceType": "POS Terminal",
  "serialNumber": "SN1234567890",
  "merchantId": "MCH-1001",
  "status": "Active"
}
```

Use an existing merchant ID. Required fields are deviceName, deviceType, serialNumber and merchantId. Devices are associated with a merchant and do not use stores. Supported types: POS Terminal, Kitchen Display, Barcode Scanner, Receipt Printer, Customer Display.

The `devices` table contains exactly these columns: `deviceName`, `deviceType`, `status`, `id`, `deviceCode`, `merchantId`, `merchantName`, `serialNumber` and `createdAt`. Store and details columns are removed. On create, `id`, `merchantName` and `createdAt` are set by the service; `deviceCode` is generated and status defaults to Active when omitted. Serial numbers are trimmed, uppercased and globally unique. New active devices are Offline with no last-seen timestamp; heartbeat tracking is outside these endpoints.

Validation failures return 400, missing merchant 404, duplicate serial 409 and unavailable database 503. Devices require PostgreSQL and are never saved to the merchant service's temporary memory fallback.

Apply the Device schema with `psql -h localhost -U pdh_user -d pinaka_commerce_hub -f docs/devices.sql`, then restart merchant-service. React `/devices/add` creates devices; `/devices` lists, searches, filters and paginates them.

Tests: `node --import tsx scripts/device-routes.test.ts` and `node --import tsx scripts/device-db.test.ts`. The database test rolls back all test records.
