# 🔌 Pinaka Commerce Hub (PCH) — Integration Layer Requirements & Daily Task Tracker

**Document Version:** 1.0.0  
**Target System:** `connector-service`, `pos-integration-service`, `merchant-service`, `gateway`  
**Database:** PostgreSQL (`pinaka_commerce_hub`) & Redis  
**Tracking Scope:** E-commerce Connectors (WooCommerce, Shopify), Aggregators (DoorDash, Uber, Instacart), POS Terminals, Webhooks, Inventory & Catalog Sync.

---

## 📋 Table of Contents
1. [Executive Overview & Objectives](#1-executive-overview--objectives)
2. [Integration Layer Architectural Blueprint](#2-integration-layer-architectural-blueprint)
3. [Key Functional Requirements](#3-key-functional-requirements)
   - [A. Catalog & Category Synchronization](#a-catalog--category-synchronization)
   - [B. Real-Time Inventory & Stock Updates](#b-real-time-inventory--stock-updates)
   - [C. Order Ingestion & POS Dispatch](#c-order-ingestion--pos-dispatch)
   - [D. Webhook Security & HMAC Verification](#d-webhook-security--hmac-verification)
   - [E. Credential Vault & Store Encryption](#e-credential-vault--store-encryption)
4. [Detailed Daily Task Breakdown & Execution Roadmap](#4-detailed-daily-task-breakdown--execution-roadmap)
   - [Phase 1: WooCommerce & WordPress Pinaka-POS Connector (Days 1–2)](#phase-1-days-1-2-woocommerce--wordpress-pinaka-pos-connector)
   - [Phase 2: Real-time Two-Way Inventory & Stock Synchronization (Days 3–4)](#phase-2-days-3-4-real-time-two-way-inventory--stock-synchronization)
   - [Phase 3: Shopify & External E-Commerce Platform Connector (Days 5–6)](#phase-3-days-5-6-shopify--external-e-commerce-platform-connector)
   - [Phase 4: Third-Party Delivery Aggregators Integration (Days 7–8)](#phase-4-days-7-8-third-party-delivery-aggregators-integration)
   - [Phase 5: POS Terminal Hardware & Terminal Pairing Gateway (Days 9–10)](#phase-5-days-9-10-pos-terminal-hardware--terminal-pairing-gateway)
   - [Phase 6: Resilience, Dead-Letter Queue (DLQ) & Audit Logging (Days 11–12)](#phase-6-days-11-12-resilience-dead-letter-queue-dlq--audit-logging)
5. [Daily Standup Tracking Checklist & Status Board](#5-daily-standup-tracking-checklist--status-board)
6. [API Endpoints & Contract Matrix](#6-api-endpoints--contract-matrix)

---

## 1. Executive Overview & Objectives

The **Integration Layer** serves as the central neural gateway of Pinaka Commerce Hub (PCH), connecting external commerce channels (WooCommerce, Shopify, DoorDash, Uber Eats, Instacart, In-store POS) to PCH core microservices (`menu-service`, `inventory-service`, `order-service`, `merchant-service`).

### Core Objectives:
* **Zero-CORS Client Isolation:** Client web portals (`pch.alektasolutions.com`) delegate all cross-origin platform integrations through secure backend server proxies.
* **Idempotent Ingestion:** Every webhook, product sync, and order ingestion must guarantee exactly-once processing with deduplication IDs.
* **Unified Canonical Schema:** Translate vendor-specific payloads (WooCommerce JSON, Shopify GraphQL, DoorDash Webhooks) into PCH `CanonicalRetailOrder` and `CanonicalProduct`.
* **Sub-Second Stock Propagation:** Ensure changes in store inventory (e.g. barcode scan, online order, POS sale) propagate across all online channels in $< 1.5$ seconds.

---

## 2. Integration Layer Architectural Blueprint

```
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                              EXTERNAL COMMERCE CHANNELS                                │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
 │  │ WooCommerce Site │  │   Shopify Store  │  │ Delivery Apps    │  │ Retail POS /   │  │
 │  │  (Pinaka-POS API)│  │ (REST / GraphQL) │  │(DoorDash / Uber) │  │ Scanner System │  │
 │  └─────────┬────────┘  └────────┬─────────┘  └────────┬─────────┘  └───────┬────────┘  │
 └────────────┼────────────────────┼─────────────────────┼────────────────────┼───────────┘
              │                    │                     │                    │
              ▼                    ▼                     ▼                    ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                    PCH INTEGRATION LAYER (connector-service : 3001)                    │
 │                                                                                        │
 │   ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────────┐    │
 │   │  HMAC Webhook Guard   │ │ Live Platform Client  │ │ Canonical Normalizer Layer│    │
 │   │  & Signature Verify   │ │ (Bearer / OAuth2 / CK)│ │ (To Canonical Retail Model│    │
 │   └──────────┬────────────┘ └──────────┬────────────┘ └─────────────┬─────────────┘    │
 │              │                         │                            │                  │
 │              └─────────────────────────┼────────────────────────────┘                  │
 │                                        ▼                                               │
 │   ┌────────────────────────────────────────────────────────────────────────────────┐   │
 │   │           Deduplication Engine (Redis Idempotency & Rate Limiter)              │   │
 │   └────────────────────────────────────┬───────────────────────────────────────────┘   │
 └────────────────────────────────────────┼───────────────────────────────────────────────┘
                                          ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                             PCH CORE MICROSERVICES & DB                                │
 │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
 │  │   Menu Service   │  │Inventory Service │  │  Order Service   │  │Merchant Service│  │
 │  │ (menu_items)     │  │(inventory_items) │  │ (orders, items)  │  │(stores, auth)  │  │
 │  └─────────┬────────┘  └────────┬─────────┘  └────────┬─────────┘  └───────┬────────┘  │
 │            │                    │                     │                    │           │
 │            ▼                    ▼                     ▼                    ▼           │
 │   ┌────────────────────────────────────────────────────────────────────────────────┐   │
 │   │             PostgreSQL Unified Database: pinaka_commerce_hub                   │   │
 │   └────────────────────────────────────────────────────────────────────────────────┘   │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Key Functional Requirements

### A. Catalog & Category Synchronization
* **Two-Step Fetch:**
  1. `GET /wp-json/wc/v3/products/categories?page=1&per_page=100&hide_empty=true` $\rightarrow$ Discover all category IDs.
  2. `GET /wp-json/pinaka-pos/v1/products-by-category/{categoryId}` $\rightarrow$ Fetch products under that category.
* **Field Mapping:**
  * `sku` / `id` $\rightarrow$ `externalItemId` (`WC-{sku}`)
  * `name` $\rightarrow$ `name`
  * `regular_price` / `price` $\rightarrow$ `price`
  * `category` $\rightarrow$ `category`
  * `description` $\rightarrow$ `description`
* **Idempotent Upsert:** Check existence before insert and update prices & availability dynamically.

### B. Real-Time Inventory & Stock Updates
* **Stock Ingestion:** On catalog sync, auto-create/update `inventory_items`:
  * `ingredientId` $\rightarrow$ `ING-{sku}`
  * `currentStock` $\rightarrow$ `stock_quantity`
  * `reorderThreshold` $\rightarrow$ Default `10`
  * `isLowStock` $\rightarrow$ `currentStock <= reorderThreshold`
* **Two-Way Sync:** When stock changes on PCH POS $\rightarrow$ Dispatch webhook to WooCommerce/Shopify to adjust stock.

### C. Order Ingestion & POS Dispatch
* **Webhook Receiver:** `@Post('woocommerce/webhook')` & `@Post('doordash/webhook')`
* **Order Translation:** Parse external items, calculate taxes, match SKU barcodes, and insert into `orders` and `order_line_items`.
* **Real-time SSE Notification:** Gateway broadcast order to connected Merchant Portal & Flutter POS terminals.

### D. Webhook Security & HMAC Verification
* Verify SHA-256 HMAC signature in headers (`x-wc-webhook-signature`, `x-doordash-signature`).
* Validate timestamp within $\pm 300$ seconds to prevent replay attacks.

### E. Credential Vault & Store Encryption
* Store JWT tokens, API keys, and consumer secrets encrypted with AES-256-GCM using `STORE_CONFIG_ENCRYPTION_KEY`.

---

## 4. Detailed Daily Task Breakdown & Execution Roadmap

### 📅 Phase 1: WooCommerce & WordPress Pinaka-POS Connector (Days 1 – 2)

- [x] **Task 1.1:** Connect to `https://aascorner.alektasolutions.com` category endpoint (`/wp-json/wc/v3/products/categories`) with Bearer token authentication.
- [x] **Task 1.2:** Connect to custom category products endpoint (`/wp-json/pinaka-pos/v1/products-by-category/{catId}`) with Bearer token authentication.
- [ ] **Task 1.3:** Handle variations, attributes (size, weight, brand), and multiple images per SKU.
- [ ] **Task 1.4:** Build pagination handler for stores with $> 100$ products.
- [x] **Task 1.5:** Map WooCommerce response directly to `menu_items` with primary key UUID generation.
- [x] **Task 1.6:** Implement backend proxy endpoint `@Post('api/v1/connectors/woocommerce/test-connection')` with live sync response summary.
- [x] **Task 1.7:** Update Web UI (`StoreConfiguration.jsx` & `storeConnector.js`) to display live sync count, errors, and success state.

---

### 📅 Phase 2: Real-Time Two-Way Inventory & Stock Synchronization (Days 3 – 4)

- [x] **Task 2.1:** Create `inventory_items` mapping engine for all WooCommerce ingested SKUs (`ING-{sku}`).
- [ ] **Task 2.2:** Build Out-Of-Stock (86-ing) webhook dispatcher to mark items unavailable on WooCommerce when local stock $= 0$.
- [ ] **Task 2.3:** Build Inventory Adjustment listener in `inventory-service` to broadcast inventory deltas via Redis Pub/Sub.
- [ ] **Task 2.4:** Implement WooCommerce Stock Update REST API client (`PUT /wp-json/wc/v3/products/{id}` with `{ stock_quantity: N }`).
- [ ] **Task 2.5:** Create low-stock notification triggers (`isLowStock = true` when stock $\le$ threshold).

---

### 📅 Phase 3: Shopify & External E-Commerce Platform Connector (Days 5 – 6)

- [ ] **Task 3.1:** Implement Shopify OAuth2 authentication workflow in `connector-service`.
- [ ] **Task 3.2:** Build Shopify Product Catalog ingest via Shopify Admin REST / GraphQL API (`products.json`).
- [ ] **Task 3.3:** Handle Shopify Webhooks (`products/create`, `products/update`, `inventory_levels/update`).
- [ ] **Task 3.4:** Add Shopify store credentials configuration UI tab in Merchant Portal.
- [ ] **Task 3.5:** Map Shopify UPC/Barcode and Variant attributes into PCH Canonical Product model.

---

### 📅 Phase 4: Third-Party Delivery Aggregators Integration (Days 7 – 8)

- [ ] **Task 4.1:** Build DoorDash Drive & Marketplace retail webhook receiver (`order.created`, `order.cancelled`).
- [ ] **Task 4.2:** Implement Uber Eats / Convenience Store catalog and menu ingestion adapter.
- [ ] **Task 4.3:** Build Instacart Grocery order ingestion adapter with catch-weight pricing support.
- [ ] **Task 4.4:** Map external aggregator order statuses (`SCHEDULED`, `DISPATCHED`, `DELIVERED`) into PCH `RetailOrderStatus`.
- [ ] **Task 4.5:** Implement Aggregator Order Outward Injection to POS KDS.

---

### 📅 Phase 5: POS Terminal Hardware & Terminal Pairing Gateway (Days 9 – 10)

- [ ] **Task 5.1:** Implement 6-digit PIN Store Pairing endpoint (`POST /api/v1/stores/pair-terminal`) in `pos-integration-service`.
- [ ] **Task 5.2:** Build Barcode Scanner verification endpoint for quick retail checkout.
- [ ] **Task 5.3:** Build POS Shift opening/closing & cash drawer reconciliation sync.
- [ ] **Task 5.4:** Implement receipt printer payload generator (ESC/POS format).
- [ ] **Task 5.5:** Setup Offline-First SQLite cache sync for Flutter POS terminal.

---

### 📅 Phase 6: Resilience, Dead-Letter Queue (DLQ) & Audit Logging (Days 11 – 12)

- [ ] **Task 6.1:** Implement Exponential Backoff Retry Policy ($1s, 5s, 15s, 60s$) for failed webhooks.
- [ ] **Task 6.2:** Create Dead Letter Queue (DLQ) table in PostgreSQL for unprocessable webhooks.
- [ ] **Task 6.3:** Build Webhook Log Viewer in Merchant Configuration UI (`woocommerce_sync_logs` & `aggregator_webhooks`).
- [ ] **Task 6.4:** Implement OpenTelemetry / Tracing Interceptor for all connector endpoints.
- [ ] **Task 6.5:** Execute load test (1,000 simulated webhook events/min) and verify 0 dropped events.

---

## 5. Daily Standup Tracking Checklist & Status Board

| Day | Focus Area | Assigned Service | Status | Target Deliverable |
| :--- | :--- | :--- | :---: | :--- |
| **Day 1** | WC REST & Category Sync | `connector-service` | 🟢 Done | Live WooCommerce Category & Product Ingest |
| **Day 2** | WC Test Connection & UI | `pinaka-commerce-hub-web` | 🟢 Done | Portal Test Connection button backend proxy |
| **Day 3** | Inventory Sync Engine | `inventory-service` | 🟡 In Progress | Auto-sync `inventory_items` stock quantities |
| **Day 4** | 2-Way Stock Updates | `connector-service` | ⚪ Not Started | Stock deduction webhooks to WooCommerce |
| **Day 5** | Shopify OAuth & Catalog | `connector-service` | ⚪ Not Started | Shopify GraphQL Product Ingest |
| **Day 6** | Shopify Webhooks | `connector-service` | ⚪ Not Started | Real-time Shopify Webhook Sync |
| **Day 7** | DoorDash & Uber Ingest | `connector-service` | ⚪ Not Started | DoorDash & Uber Order Webhook Adapters |
| **Day 8** | Instacart & Aggregator POS | `order-service` | ⚪ Not Started | Aggregator Order Injection into PCH POS |
| **Day 9** | POS Pairing by PIN | `pos-integration-service` | ⚪ Not Started | 6-Digit PIN POS Terminal Pairing |
| **Day 10** | Barcode Checkout & Shifts | `pos-integration-service` | ⚪ Not Started | Scanner Lookup & Shift Cash Sync |
| **Day 11** | DLQ & Retry Mechanics | `connector-service` | ⚪ Not Started | Exponential backoff & DLQ table |
| **Day 12** | Webhook Audit Dashboard | `pinaka-commerce-hub-web` | ⚪ Not Started | Webhook Log Viewer on Web Portal |

---

## 6. API Endpoints & Contract Matrix

| Method | Endpoint | Service | Port | Description |
| :--- | :--- | :--- | :---: | :--- |
| `POST` | `/api/v1/connectors/woocommerce/test-connection` | `connector-service` | 3001 | Tests WooCommerce reachability & ingests full catalog & stock |
| `POST` | `/api/v1/connectors/woocommerce/sync` | `connector-service` | 3001 | Triggers full catalog resynchronization |
| `POST` | `/api/v1/connectors/woocommerce/webhook` | `connector-service` | 3001 | Receives real-time WooCommerce webhooks (`product.created`, `order.created`) |
| `GET` | `/api/v1/connectors/woocommerce/connection` | `connector-service` | 3001 | Retrieves active connection status and last sync timestamp |
| `PUT` | `/api/v1/stores/:storeId/connector` | `merchant-service` | 3003 | Saves encrypted store connector credentials |
| `GET` | `/api/v1/stores/:storeId/connector` | `merchant-service` | 3003 | Gets store connector metadata (encrypted secret hidden) |
| `POST` | `/api/v1/pos/terminals/pair` | `pos-integration-service` | 3007 | Pairs POS terminal hardware using activation PIN |
| `GET` | `/api/v1/pos/products/barcode/:barcode` | `pos-integration-service` | 3007 | Instant barcode scanner SKU lookup |
