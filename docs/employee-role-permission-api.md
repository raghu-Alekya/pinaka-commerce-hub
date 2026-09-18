# Employee, role and permission APIs (PDF section 5)

Base URL: `http://localhost:3003/api/v1`

These administration endpoints require an active bearer session with the `OWNER` role. Employee, role and permission master endpoints now use the same owner guard as relationship administration. JSON request and response fields use camelCase; the section 5 database tables use snake_case.

## Automatic tables

`MerchantRepository.onModuleInit()` calls `ensureEmployeeAccessSchema()` before using the workforce repositories. It creates missing `employees`, `roles`, `permissions`, `role_templates`, `employee_stores`, `employee_store_roles`, `role_template_permissions`, and `role_permissions` tables. No manual section 5 SQL execution is needed. The merchant connection always disables TypeORM synchronization, even if `TYPEORM_SYNCHRONIZE=true` enables it for other services: repository-owned foreign keys depend on indexes that TypeORM must not remove. Other services migrate only tables present in their own entity metadata.

The existing `merchants`, `stores`, and `features` parent tables must be installed. Merchant and store ID types are detected from PostgreSQL. Initialization uses a transaction and the shared schema advisory lock. Existing rows are preserved; legacy camelCase master columns are renamed to their snake_case equivalents. Ambiguous duplicate column layouts fail explicitly. Foreign keys enforce merchant ownership for new employee/store/role tables, and the repository checks tenant scope on requests. A unique index permits only one primary store per employee; clear the old assignment's `isPrimary` flag before choosing another.

## Master endpoints

| Resource | Collection |
| --- | --- |
| Employees | `/merchants/:merchantId/employees` |
| Roles | `/merchants/:merchantId/roles` |
| Permissions | `/permissions` |

Each supports `GET` (list), `POST` (create), and `GET`, `PUT`, `PATCH`, `DELETE` on `/:idOrCode` (employees/roles) or `/:idOrKey` (permissions). PUT and PATCH both update supplied mutable fields. DELETE deactivates the master record. Lists accept `?status=ACTIVE`; permissions also accept `?featureId=<uuid>`. The path supplies the authoritative merchant ID, so it need not appear in the body.

Create employee:

```json
{ "employeeCode": "EMP-1007", "firstName": "Sarah", "lastName": "Jones", "email": "sarah@example.com", "status": "ACTIVE" }
```

Create role:

```json
{ "roleCode": "STORE_MANAGER", "name": "Store Manager", "scopeType": "STORE", "isCustom": true, "status": "ACTIVE" }
```

Optionally supply `sourceRoleTemplateId`. The repository copies that template's `defaultAllowed` permission mappings into the new role's actual `allowed` mappings in the same transaction. Later template edits do not change existing roles. Roles belong to the merchant and are assigned to employees through a store assignment, never through an `employees.role_id` field.

Create permission (feature must already exist):

```json
{ "featureId": "<feature UUID>", "permissionKey": "POS_SALE_CREATE", "name": "Create Sale", "description": "Create POS sales", "status": "ACTIVE" }
```

## Section 5 relationship endpoints

| Collection path | POST child key | Mutable fields |
| --- | --- | --- |
| `/merchants/:merchantId/employees/:employeeId/stores` | `storeId` | `isPrimary`, `status`, `effectiveFrom`, `effectiveUntil` |
| `/merchants/:merchantId/employee-stores/:employeeStoreId/roles` | `roleId` | `status`, `effectiveFrom`, `effectiveUntil` |
| `/role-templates/:roleTemplateId/permissions` | `permissionId` | `defaultAllowed` |
| `/merchants/:merchantId/roles/:roleId/permissions` | `permissionId` | `allowed` |

Every collection supports:

- `GET` collection: `{ "success": true, "count": 1, "items": [...] }`.
- `POST` collection: create a mapping; returns HTTP 201 with `{ "success": true, "item": {...} }`.
- `GET /:relatedId`: fetch a mapping using the **child ID**, not the mapping ID.
- `PUT /:relatedId`: replace mutable fields; omitted fields reset to defaults.
- `PATCH /:relatedId`: change supplied mutable fields.
- `DELETE /:relatedId`: physically remove the relationship. For historical assignments, prefer PATCH with `status: "INACTIVE"` and/or `effectiveUntil`. Remove role links before deleting an employee-store assignment.

An employee-store POST response's `item.id` is the `employeeStoreId` used for assigning roles. It is distinct from the employee ID and store ID.

### Example workflow

```bash
curl --request POST "http://localhost:3003/api/v1/merchants/MER-1001/employees/EMPLOYEE_UUID/stores" \
  --header "Authorization: Bearer YOUR_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"storeId":"STR-5001","isPrimary":true,"status":"ACTIVE"}'

curl --request POST "http://localhost:3003/api/v1/merchants/MER-1001/employee-stores/ASSIGNMENT_UUID/roles" \
  --header "Authorization: Bearer YOUR_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"roleId":"ROLE_UUID","status":"ACTIVE"}'

curl --request POST "http://localhost:3003/api/v1/merchants/MER-1001/roles/ROLE_UUID/permissions" \
  --header "Authorization: Bearer YOUR_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"permissionId":"PERMISSION_UUID","allowed":true}'
```

Flags default to false; assignment status defaults to ACTIVE. Dates are optional ISO-8601 strings with timezone, or null. `effectiveUntil` must be later than `effectiveFrom`. Access is inclusive at the start and exclusive at the end. An employee can have multiple roles and stores; a permission is granted if any active role in the selected store has `allowed: true`. A false mapping means that role does not grant the permission; it is not a global deny against another role.

## Effective access (section 5.5)

`GET /merchants/:merchantId/employees/:employeeId/stores/:storeId/effective-access`

Optional query: `?permissionKey=POS_SALE_CREATE`. Without it, returns the permission catalog with the decision for each permission.

```json
{
  "success": true,
  "merchantId": "MER-1001",
  "employeeId": "<employee UUID>",
  "storeId": "STR-5001",
  "evaluatedAt": "2026-09-15T06:00:00.000Z",
  "employeeStoreId": "<assignment UUID>",
  "roleIds": ["<role UUID>"],
  "count": 1,
  "permissions": [{
    "permissionId": "<permission UUID>",
    "permissionKey": "POS_SALE_CREATE",
    "featureId": "<feature UUID>",
    "featureKey": "POS",
    "entitled": true,
    "roleAllowed": true,
    "allowed": true,
    "reason": "ALLOWED"
  }]
}
```

Decisions require active employee, active store, active and in-date store assignment, active store license and active/trial subscription with an active plan, relevant active store type and feature, commercial entitlement, store override allowance, an active in-date role assignment, active role, active permission, and an actual role grant. Subscription overrides can change plan grants; store overrides can disable but cannot grant an unpurchased feature. Template permissions alone do not authorize an employee.

Denial reasons: `EMPLOYEE_INACTIVE`, `STORE_INACTIVE`, `STORE_ASSIGNMENT_MISSING`, `STORE_NOT_LICENSED`, `PERMISSION_INACTIVE`, `FEATURE_INACTIVE`, `FEATURE_NOT_RELEVANT`, `FEATURE_NOT_ENTITLED`, `STORE_FEATURE_DISABLED`, `ROLE_MISSING`, `PERMISSION_MISSING`.

This resolver reads the existing section 3/4 entitlement tables; it does not install those commercial schemas. Protected business-operation APIs must invoke the resolver and reject denied operations; the new administration/inspection API does not retrofit every existing POS endpoint.

## Errors and verification

- 400: invalid fields, UUIDs, dates, or nonexistent feature on permission creation.
- 401: missing/invalid session; 403: non-owner.
- 404: missing record or merchant-scope mismatch.
- 409: duplicate mapping/code, second primary store, or referenced mapping still in use.
- 503: required commercial schema unavailable for effective-access resolution.

Run `node --import tsx scripts/employee-access-api.test.ts`. It creates a uniquely named temporary PostgreSQL database, verifies fresh/repeat initialization, API writes, template copying, ownership, validation and access decisions, then removes only that test database. The database user needs CREATE DATABASE permission for this test.

Import `docs/postman/PCH - Employee Role Permission APIs.postman_collection.json` for requests. Set the bearer token and existing merchant/store/feature IDs. Create requests capture new IDs into collection variables.
