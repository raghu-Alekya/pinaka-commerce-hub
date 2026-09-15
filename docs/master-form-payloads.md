# Master setup form payloads

The merchant-service master routes accept the canonical Postman fields and these form aliases. Responses and stored data retain the canonical schema.

| Route | Form field | Canonical field |
| --- | --- | --- |
| `/api/v1/store-types` | `code` | `storeTypeCode` |
| `/api/v1/features` | `type` | `featureType` |
| `/api/v1/role-templates` | `key`, `scope` | `roleCode`, `scopeType` |
| `/api/v1/plans` | `code`, `price`, `cycle` | `planCode`, `basePrice`, `billingCycle` |
| `/api/v1/store-types/:storeTypeId/features` | `order` | `displayOrder` |

Master POST, PUT and PATCH requests normalize status and enum labels: `Active` → `ACTIVE`, `Inactive` → `INACTIVE`, `Per store` → `PER_STORE`, `Per device` → `PER_DEVICE`, `Flat rate` → `FLAT`, `Monthly` → `MONTHLY`, `Yearly` → `ANNUAL`, and scope `Store` → `STORE`. Status subroutes accept the same status labels. Non-empty string prices are converted to numbers and validated, including zero. Conflicting aliases and canonical fields are rejected.

Feature creation still requires a stable `featureKey`; plan creation still requires a three-letter `currency`. These values are not inferred. Quarterly billing is not supported by the existing plan schema and remains a validation error. Mapping requests require saved feature/role UUIDs; sample numeric IDs and display-only properties (icons, tones, formatted dates) are not accepted as persistence fields.

React was not changed. Its existing master forms currently update local state and do not call these endpoints. This backend compatibility layer does not itself connect those forms or persist their local data.
