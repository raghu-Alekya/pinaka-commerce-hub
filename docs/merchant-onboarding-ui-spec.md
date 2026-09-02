# 🖥️ Merchant Onboarding Portal (`pch.alekyatechsolutions.com`) — UI/UX Specification & Technical Mapping

---

## 📌 Executive Summary

This document defines the **User Interface (UI/UX) layout, step-by-step screen designs, form fields, and 1:1 technical database entity mappings** for the Merchant Onboarding Wizard and Dashboard at **`pch.alekyatechsolutions.com`**.

---

## 🎨 1. Step-by-Step UI Onboarding Wizard (Visual Layout)

The onboarding flow is designed as a clean, modern **4-Step Wizard with a Progress Tracker**:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│  🛍️ PINAKA COMMERCE HUB  |  Merchant Onboarding Wizard              Need Help? Support: 24/7     │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│       [ 1. Business Info ] ────► [ 2. Store Setup ] ────► [ 3. Subscription ] ────► [ 4. KYC & Launch ]  │
│             (Active)                  (Pending)                (Pending)               (Pending)         │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🗂️ 2. Field-by-Field UI to Technical Entity Mapping

---

### 🟢 Step 1: Business Profile & Account Setup (`merchants` entity)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: BUSINESS PROFILE                                                                         │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  Business Legal Name *                    Business Vertical / Type *                             │
│  [ Fresh Mart Organics LLC             ]  (o) Retail / Grocery / Convenience                     │
│                                           ( ) Restaurant / Cafe / Fast Food                      │
│                                                                                                  │
│  Primary Contact / Owner Name *           Owner Email Address *                                  │
│  [ Alex Johnson                        ]  [ alex@freshmart.com                 ]                 │
│                                                                                                  │
│  Primary Phone Number *                   Password *                                             │
│  [ +1 (555) 234-5678                   ]  [ •••••••••••••••••                  ]                 │
│                                                                                                  │
│                                                      [ Next: Store Setup ➔ ]                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 🔗 Technical Mapping (Step 1 ➔ `merchants` Table):
| UI Field Label | Input Type | Database Column | Data Type / Enum | Example Value |
| :--- | :--- | :--- | :--- | :--- |
| *Auto-Generated* | System generated | `merchants.id` | `VARCHAR(100)` (PK) | `"MCH-1001"` |
| **Business Legal Name** | Text Input | `merchants.businessName` | `VARCHAR(255)` | `"Fresh Mart Organics LLC"` |
| **Business Vertical** | Radio Select | `merchants.businessType` | `ENUM('RETAIL', 'RESTAURANT', 'CONVENIENCE', 'GROCERY')` | `'GROCERY'` |
| **Primary Contact / Owner**| Text Input | `merchants.ownerName` | `VARCHAR(150)` | `"Alex Johnson"` |
| **Owner Email Address** | Email Input | `merchants.email` | `VARCHAR(255)` (Unique) | `"alex@freshmart.com"` |
| **Primary Phone Number** | Tel Input | `merchants.phone` | `VARCHAR(50)` | `"+15552345678"` |
| *Status Tracking* | System state | `merchants.status` | `ENUM('PENDING', 'ACTIVE', 'SUSPENDED')` | `'PENDING'` |
| *Progress Step* | System state | `merchants.onboardingStep` | `VARCHAR(50)` | `'STORE_DETAILS'` |

---

### 🏪 Step 2: First Store Branch Setup (`stores` entity)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: STORE BRANCH SETUP                                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  Store Name *                             Store Internal Identifier / Code *                     │
│  [ Fresh Mart - Downtown               ]  [ STR-DT-01                          ]                 │
│                                                                                                  │
│  Street Address *                         City, State, Zip Code *                                │
│  [ 123 Main Street, Suite 400          ]  [ Austin         ] [ TX ] [ 78701    ]                 │
│                                                                                                  │
│  Currency *                               Timezone *                                             │
│  [ USD ($) - United States Dollar   ▼ ]  [ America/Chicago (CST)              ▼ ]                │
│                                                                                                  │
│  Default Tax Rate (%) *                   Auto-Accept Online Delivery Orders                     │
│  [ 8.25 %                              ]  [X] Automatically accept Uber Eats / DoorDash orders   │
│                                                                                                  │
│  6-Digit Terminal Activation PIN (Auto-Generated - Keep Secret for Sunmi POS)                   │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │   🔑 STORE ACTIVATION PIN:   [ 8 4 9 2 0 1 ]   (Click to Copy / Regenerate)                 │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                  │
│  [ ⬅ Back ]                                          [ Next: Choose Plan ➔ ]                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 🔗 Technical Mapping (Step 2 ➔ `stores` Table):
| UI Field Label | Input Type | Database Column | Data Type / Enum | Example Value |
| :--- | :--- | :--- | :--- | :--- |
| *Auto-Generated* | System generated | `stores.id` | `VARCHAR(100)` (PK) | `"STR-5001"` |
| *Merchant Link* | Hidden FK | `stores.merchantId` | `VARCHAR(100)` (FK) | `"MCH-1001"` |
| **Store Name** | Text Input | `stores.storeName` | `VARCHAR(255)` | `"Fresh Mart - Downtown"` |
| **Store Internal Code** | Text Input | `stores.storeCode` | `VARCHAR(50)` (Unique) | `"STR-DT-01"` |
| **Store Vertical** | Inherited/Override | `stores.storeType` | `ENUM('RETAIL', 'RESTAURANT', 'GROCERY')` | `'GROCERY'` |
| **Address Fields** | Street/City/Zip | `stores.address` | `JSONB` | `{"street":"123 Main St","city":"Austin","state":"TX","zip":"78701"}` |
| **Currency** | Dropdown | `stores.currency` | `VARCHAR(10)` | `"USD"` |
| **Timezone** | Dropdown | `stores.timezone` | `VARCHAR(100)` | `"America/Chicago"` |
| **Tax Rate** | Number Input | `stores.taxRate` | `DECIMAL(5,2)` | `8.25` |
| **Auto-Accept Orders** | Checkbox | `stores.autoAcceptOrders`| `BOOLEAN` | `true` |
| **Terminal Activation PIN**| Display Card | `stores.activationPin` | `VARCHAR(10)` (Indexed) | `"849201"` |
| *Store Status* | Default state | `stores.status` | `ENUM('ACTIVE', 'PENDING', 'SUSPENDED')` | `'ACTIVE'` |
| *Operational Status* | Default state | `stores.operationalStatus`| `ENUM('OPEN', 'CLOSED', 'PAUSED')` | `'OPEN'` |

---

### 💳 Step 3: Subscription Plan & Feature Entitlements (`subscriptions` entity)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: SELECT SUBSCRIPTION PLAN                                                                 │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   ┌───────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐  │
│   │ 🟢 STARTER POS            │   │ 🌟 PRO COMMERCE (POPULAR) │   │ 🏢 ENTERPRISE MULTI-STORE │  │
│   │ $49 / month               │   │ $99 / month               │   │ $199 / month              │  │
│   ├───────────────────────────┤   ├───────────────────────────┤   ├───────────────────────────┤  │
│   │ • 1 Store Location        │   │ • Up to 3 Store Locations │   │ • Unlimited Stores        │  │
│   │ • In-Store POS Terminal   │   │ • In-Store POS Terminal   │   │ • All POS Features        │  │
│   │ • Basic Inventory & Taxes │   │ • Barcode Scanning & Scale│   │ • Custom ERP Integrations │  │
│   │ • Thermal Receipt Print   │   │ • Uber Eats & DoorDash Hub│   │ • Multi-location Inventory│  │
│   │                           │   │ • Employee Payroll & Shift│   │ • 24/7 Dedicated Support  │  │
│   │ [ Select Starter ]        │   │ [ Selected (Active) ✓ ]   │   │ [ Select Enterprise ]     │  │
│   └───────────────────────────┘   └───────────────────────────┘   └───────────────────────────┘  │
│                                                                                                  │
│   Billing Cycle:   (o) Monthly Billing      ( ) Annual Billing (Save 20%)                        │
│                                                                                                  │
│  [ ⬅ Back ]                                          [ Next: KYC Verification ➔ ]                │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 🔗 Technical Mapping (Step 3 ➔ `subscriptions` Table):
| UI Field Label | Input Type | Database Column | Data Type / Enum | Example Value |
| :--- | :--- | :--- | :--- | :--- |
| *Auto-Generated* | System generated | `subscriptions.id` | `VARCHAR(100)` (PK) | `"SUB-9001"` |
| *Merchant Link* | Hidden FK | `subscriptions.merchantId` | `VARCHAR(100)` (FK) | `"MCH-1001"` |
| **Plan Selection** | Card Selector | `subscriptions.planCode` | `ENUM('STARTER', 'PRO', 'ENTERPRISE')` | `'PRO'` |
| **Plan Display Name** | Card Title | `subscriptions.planName` | `VARCHAR(100)` | `"Pro Commerce Plan"` |
| **Store Locations Limit**| Auto from Card | `subscriptions.maxStoresAllowed`| `INTEGER` | `3` |
| **Feature Entitlements** | Pre-set Array | `subscriptions.entitlements` | `JSONB` (Array of Strings) | `["POS", "BARCODE_SCANNING", "UBER_EATS", "DOORDASH", "PAYROLL", "LOYALTY"]` |
| **Billing Cycle** | Radio Select | `subscriptions.billingCycle` | `ENUM('MONTHLY', 'ANNUAL')` | `'MONTHLY'` |
| **Subscription Status** | Payment state | `subscriptions.status` | `ENUM('ACTIVE', 'TRIAL', 'PAST_DUE')` | `'ACTIVE'` |

---

### 📄 Step 4: KYC Verification & Document Upload (`merchants.kycDocuments` & `onboarding_audit_logs`)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: KYC VERIFICATION & ACTIVATION                                                            │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  1. Business Tax ID / EIN / GST Number *                                                         │
│  [ 12-3456789                                                      ]                             │
│                                                                                                  │
│  2. Upload Business License / Registration Document (PDF, JPEG) *                                │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │   📁 Drag & drop business_license.pdf here  or  [ Browse Files ]                            │ │
│  │   Uploaded: business_registration_cert.pdf  (1.4 MB)  ✅ Ready                              │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                  │
│  3. Upload Owner Government ID (Passport / Driver's License) *                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │   📁 Drag & drop drivers_license.jpg here  or  [ Browse Files ]                             │ │
│  │   Uploaded: alex_johnson_license.jpg  (850 KB)  ✅ Ready                                    │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                  │
│  [ ⬅ Back ]                                          [ Complete Onboarding & Launch Dashboard 🚀 ]│
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 🔗 Technical Mapping (Step 4 ➔ `merchants` & `onboarding_audit_logs`):
| UI Field Label | Input Type | Database Column | Target Table | Example Value |
| :--- | :--- | :--- | :--- | :--- |
| **Tax ID / EIN / GST** | Text Input | `merchants.taxId` | `merchants` | `"12-3456789"` |
| **Uploaded Files** | File Uploader | `merchants.kycDocuments` | `merchants` | `[{"docType":"BUSINESS_LICENSE","url":"https://s3.../lic.pdf","status":"PENDING"}]` |
| **KYC Initial Status** | Default state | `merchants.kycStatus` | `merchants` | `'PENDING'` (Awaiting Admin Review) |
| *Audit Log Action* | Automatic | `onboarding_audit_logs.action` | `onboarding_audit_logs` | `'MERCHANT_ONBOARDING_COMPLETED'` |
| *Audit Details* | Automatic | `onboarding_audit_logs.details` | `onboarding_audit_logs` | `{"ip":"192.168.1.1","storesCreated":1,"plan":"PRO"}` |

---

## 📊 3. Post-Onboarding Merchant Management Dashboard View

Once onboarding is completed, the merchant is redirected to their **Main Backoffice Dashboard**:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│  🛍️ PINAKA COMMERCE HUB  |  Store: [ Fresh Mart - Downtown ▼ ]       👤 Alex Johnson (Owner)    │
├───────────────────┬──────────────────────────────────────────────────────────────────────────────┤
│ 📊 Dashboard      │  OVERVIEW & METRICS                                                          │
│ 🏪 Store Branches │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐            │
│ 📦 Catalog & SKUs │  │ Today's Sales    │  │ In-Store POS Orders│ Delivery Orders │            │
│ 🏷️ Barcodes / PLU │  │ $ 4,280.50       │  │ 142 Orders       │ 38 Orders        │            │
│ 👥 Staff & Shifts │  └──────────────────┘  └──────────────────┘  └──────────────────┘            │
│ 💵 Safe Drop Ledger│                                                                             │
│ 💳 Subscription   │  STORE BRANCHES (1 of 3 Stores Active)              [ + Add New Branch ]     │
│ ⚙️ Settings       │  ┌────────────────────────────────────────────────────────────────────────┐  │
│                   │  │ Store Name: Fresh Mart - Downtown (STR-DT-01)   Status: 🟢 ACTIVE      │  │
│                   │  │ Activation PIN: [ 8 4 9 2 0 1 ]                 Type: 🛒 RETAIL        │  │
│                   │  │ Channels: [✓ DoorDash] [✓ Uber Eats] [✓ POS]    [ Manage Settings ⚙️ ]  │  │
│                   │  └────────────────────────────────────────────────────────────────────────┘  │
└───────────────────┴──────────────────────────────────────────────────────────────────────────────┘
```

---

## 💡 4. Validation of Your Assumption: Should We Create UI First or Backend First?

> **Your Question:** *"accordingly after creating the UI then i would like to implement this module 1, am I right in this assumption?"*

### 👉 **Our Recommendation (Best Practice): Contract-First Parallel Execution**

1. **Designing the UI Mockup & Wireframe First:**
   * **100% RIGHT!** It gives your web developers and stakeholders total clarity on every button, input box, and flow.
2. **Implementing Module 1 Backend APIs in Parallel:**
   * Building the **Module 1 Database Entities & REST APIs (`apps/merchant-service`)** now means that the moment your frontend team finishes the HTML/React/PHP forms at `pch.alekyatechsolutions.com`, the endpoints are **already live, tested, and waiting to receive form submissions**!
   * This eliminates developer downtime and ensures end-to-end testing immediately.

---

### 🚀 Summary
This specification gives your UI and Backend developers an exact 1:1 blueprint. Whenever you are ready, I can immediately implement the **Module 1 database tables, repository with Redis, and REST endpoints**!
