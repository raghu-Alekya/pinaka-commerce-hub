# Merchant Service – Modular Structure

This version reorganizes the existing `merchant-service` code by business module without removing existing source files or changing controller route decorators/function implementations.

## Structure

```text
src/
├── app.module.ts
├── main.ts
├── entities/                         # Existing TypeORM entities
├── modules/
│   ├── master/
│   │   ├── store-setup/              # Store setup, store types, store-type mappings, store role templates
│   │   ├── feature/                  # Feature access and feature master APIs
│   │   ├── permissions/              # Permissions, feature permissions, role permissions
│   │   ├── role-templates/           # Roles, role templates and role-template mappings
│   │   ├── plans/                    # Plans, subscriptions and merchant plan features
│   │   ├── tenders/                  # Tenders and merchant-tender APIs
│   │   └── master.module.ts
│   ├── merchant/                     # Merchant APIs, repository and merchant CRUD infrastructure
│   ├── store/                        # Store/device APIs
│   ├── employee/                     # Employee, access and merchant-employee APIs
│   ├── vendor/                       # Vendor and merchant-vendor APIs
│   ├── dynamic-query/                # Dynamic query controller/service/repository
│   └── shared/                       # Relationship infrastructure and shared auth guard
└── pos/                              # Existing POS feature folders + PosModule
```

## Important compatibility points

- Existing controller route paths were retained.
- Existing function implementations were retained.
- Existing DTO/schema/repository/service code was retained and only local import paths were updated.
- Existing TypeORM entities remain under `src/entities`.
- Existing POS feature folders remain intact; `PosModule` now composes them.
- `RoleTemplatePermissionsReplaceController`, which was explicitly registered by the original application module, remains explicitly registered.
- The application root now composes the feature modules through `AppModule`.

The original ZIP's source files are all represented in the new ZIP; the added `*.module.ts` files provide the new NestJS module boundaries.
