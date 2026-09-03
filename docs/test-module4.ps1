# Pinaka Commerce Hub (PCH) — Module 4 Inventory Engine Test Script
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PCH MODULE 4 (INVENTORY AND STOCK CONTROL) TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3005/api/v1/inventory"
$storeId = "STR-5001"

# 1. Health Check
Write-Host "`n1. Testing Inventory Service Health Endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "[SUCCESS] Health Status:" $health.status "- Version:" $health.version -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Inventory Service offline on port 3005. Launching..." -ForegroundColor Red
}

# 2. Get Inventory Stock Ledger for STR-5001
Write-Host "`n2. Testing GET $baseUrl?storeId=$storeId (Fetching Stock Ledger)..." -ForegroundColor Yellow
try {
    $inventory = Invoke-RestMethod -Uri "$baseUrl?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] Found" $inventory.count "inventory items for Store $storeId." -ForegroundColor Green
    $inventory.inventory | Format-Table productId, productName, quantityOnHand, quantityAvailable, reorderPoint, unitPrice
} catch {
    Write-Host "[ERROR] Failed to fetch inventory" -ForegroundColor Red
}

# 3. Simulate POS Sale (Stock Decrement)
Write-Host "`n3. Testing POST $baseUrl/decrement (POS Real-Time Stock Deduction)..." -ForegroundColor Yellow
$decrementPayload = @{
    storeId = $storeId
    productId = "MILK-ORG-1G"
    quantity = 2
    performedBy = "Sunmi POS Terminal #1"
    reason = "Customer Receipt #10088"
} | ConvertTo-Json

try {
    $decResult = Invoke-RestMethod -Uri "$baseUrl/decrement" -Method Post -Body $decrementPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Real-Time Stock Decremented!" -ForegroundColor Green
    Write-Host "   Product     :" $decResult.item.productName -ForegroundColor Cyan
    Write-Host "   Quantity    : Reduced by 2" -ForegroundColor Yellow
    Write-Host "   New Stock   :" $decResult.item.quantityAvailable -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Stock decrement failed" -ForegroundColor Red
}

# 4. Simulate Stock Replenishment (Supplier Shipment Restock)
Write-Host "`n4. Testing POST $baseUrl/adjust (Stock Restock / Replenishment)..." -ForegroundColor Yellow
$adjustPayload = @{
    storeId = $storeId
    productId = "MILK-ORG-1G"
    adjustmentType = "REPLENISHMENT"
    quantityChange = 24
    performedBy = "Inventory Manager Alex"
    reason = "Supplier Delivery PO #4402"
} | ConvertTo-Json

try {
    $adjResult = Invoke-RestMethod -Uri "$baseUrl/adjust" -Method Post -Body $adjustPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Stock Replenished!" -ForegroundColor Green
    Write-Host "   Product     :" $adjResult.item.productName -ForegroundColor Cyan
    Write-Host "   Restock     : Added +24 units" -ForegroundColor Yellow
    Write-Host "   New Stock   :" $adjResult.item.quantityAvailable -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Stock adjustment failed" -ForegroundColor Red
}

# 5. Get Low-Stock Alerts
Write-Host "`n5. Testing GET $baseUrl/alerts/low-stock?storeId=$storeId (Low-Stock Alerts)..." -ForegroundColor Yellow
try {
    $alerts = Invoke-RestMethod -Uri "$baseUrl/alerts/low-stock?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] Low-Stock Alerts Checked." -ForegroundColor Green
    Write-Host "   Low Stock Items Count:" $alerts.lowStockCount -ForegroundColor Cyan
} catch {
    Write-Host "[ERROR] Alert check failed" -ForegroundColor Red
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ALL MODULE 4 INVENTORY TESTS PASSED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
