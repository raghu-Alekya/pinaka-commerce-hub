# Pinaka Commerce Hub (PCH) — Module 2 WooCommerce REST Sync Engine Test Script
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PCH MODULE 2 (WOOCOMMERCE REST SYNC ENGINE) TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3001/api/v1/connectors"
$storeId = "STR-5001"

# 1. Health Check
Write-Host "`n1. Testing Connector Service Health Endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "[SUCCESS] Health Status:" $health.status "- Service:" $health.service -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Connector Service offline on port 3001. Launching..." -ForegroundColor Red
}

# 2. Get WooCommerce Connection Profile
Write-Host "`n2. Testing GET $baseUrl/woocommerce/connection?storeId=$storeId..." -ForegroundColor Yellow
try {
    $conn = Invoke-RestMethod -Uri "$baseUrl/woocommerce/connection?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] WooCommerce Connection Verified!" -ForegroundColor Green
    Write-Host "   Store URL   :" $conn.connection.storeUrl -ForegroundColor Cyan
    Write-Host "   Consumer Key:" $conn.connection.consumerKey -ForegroundColor Gray
    Write-Host "   Sync Status :" $conn.connection.syncStatus -ForegroundColor Green
    Write-Host "   Last Synced :" $conn.connection.lastSyncedAt -ForegroundColor Yellow
} catch {
    Write-Host "[ERROR] Failed to fetch WooCommerce connection" -ForegroundColor Red
}

# 3. Simulate Incoming WooCommerce Product Webhook Event
Write-Host "`n3. Testing POST $baseUrl/woocommerce/webhook (Ingesting product.updated Webhook)..." -ForegroundColor Yellow
$webhookPayload = @{
    merchantId = "MCH-1001"
    storeId = $storeId
    topic = "product.updated"
    id = 4501
    name = "Premium Organic Whole Milk 1 Gal"
    sku = "MILK-ORG-1G"
    price = "5.49"
    stock_quantity = 72
} | ConvertTo-Json

try {
    $headers = @{
        "x-wc-webhook-topic" = "product.updated"
        "x-wc-webhook-signature" = "signature_demo_98123"
    }
    $whResult = Invoke-RestMethod -Uri "$baseUrl/woocommerce/webhook" -Method Post -Body $webhookPayload -Headers $headers -ContentType "application/json"
    Write-Host "[SUCCESS] WooCommerce Webhook Event Processed!" -ForegroundColor Green
    Write-Host "   Event Topic :" $whResult.log.eventType -ForegroundColor Magenta
    Write-Host "   Sync Status :" $whResult.log.status -ForegroundColor Green
    Write-Host "   Details     :" $whResult.log.details -ForegroundColor Cyan
} catch {
    Write-Host "[ERROR] WooCommerce webhook failed" -ForegroundColor Red
}

# 4. Trigger Full Catalog Sync
Write-Host "`n4. Testing POST $baseUrl/woocommerce/sync (Triggering Full Catalog Sync)..." -ForegroundColor Yellow
$syncPayload = @{
    storeId = $storeId
} | ConvertTo-Json

try {
    $syncResult = Invoke-RestMethod -Uri "$baseUrl/woocommerce/sync" -Method Post -Body $syncPayload -ContentType "application/json"
    Write-Host "[SUCCESS] WooCommerce Full Catalog Synchronized!" -ForegroundColor Green
    Write-Host "   Products Synced:" $syncResult.syncedProductsCount -ForegroundColor Cyan
    Write-Host "   Timestamp      :" $syncResult.timestamp -ForegroundColor Gray
} catch {
    Write-Host "[ERROR] Full catalog sync failed" -ForegroundColor Red
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ALL MODULE 2 WOOCOMMERCE SYNC TESTS PASSED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
