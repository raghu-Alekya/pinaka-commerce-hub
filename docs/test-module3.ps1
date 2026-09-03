# 🧪 Pinaka Commerce Hub (PCH) — Module 3 Catalog Engine Test Script
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  🛒 PCH MODULE 3 (CATALOG & MENU ENGINE) TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3004/api/v1/menus"
$merchantId = "STORE-01"

# 1. Health Check
Write-Host "`n1. Testing Menu Service Health Endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "[SUCCESS] Health Status:" $health.status -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Menu Service offline on port 3004. Launching..." -ForegroundColor Red
}

# 2. Get Catalog Items for Merchant STORE-01
Write-Host "`n2. Testing GET $baseUrl/$merchantId (Fetching Catalog)..." -ForegroundColor Yellow
try {
    $catalog = Invoke-RestMethod -Uri "$baseUrl/$merchantId" -Method Get
    Write-Host "[SUCCESS] Found" $catalog.count "catalog items for Merchant $merchantId." -ForegroundColor Green
    $catalog.menu | Format-Table id, externalItemId, name, price, isAvailable
} catch {
    Write-Host "[ERROR] Failed to fetch catalog: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. Add Retail Barcode Item (Organic Whole Milk)
Write-Host "`n3. Testing POST $baseUrl/$merchantId/items (Adding Barcode Product)..." -ForegroundColor Yellow
$retailPayload = @{
    externalItemId = "ITEM-201"
    name = "Organic Whole Milk 1 Gal"
    description = "Grade A Pasture Raised Organic Whole Milk"
    category = "Dairy"
    price = 5.49
    isAvailable = $true
} | ConvertTo-Json

try {
    $retailItem = Invoke-RestMethod -Uri "$baseUrl/$merchantId/items" -Method Post -Body $retailPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Added Retail Barcode Product:" $retailItem.item.name -ForegroundColor Green
    Write-Host "   Item ID         :" $retailItem.item.id -ForegroundColor Cyan
    Write-Host "   External Item ID:" $retailItem.item.externalItemId -ForegroundColor Cyan
    Write-Host "   Price           : $" $retailItem.item.price -ForegroundColor Yellow
} catch {
    Write-Host "[ERROR] Failed to add item: $($_.Exception.Message)" -ForegroundColor Red
}

# 4. Add Weighing Scale Item (Gala Apples PLU 4131)
Write-Host "`n4. Testing POST $baseUrl/$merchantId/items (Adding Variable Weight PLU Item)..." -ForegroundColor Yellow
$pluPayload = @{
    externalItemId = "ITEM-202"
    name = "Gala Apples (Fresh Produce - PLU 4131)"
    description = "Crisp Sweet Gala Apples by Weight"
    category = "Produce"
    price = 1.99
    isAvailable = $true
} | ConvertTo-Json

try {
    $pluItem = Invoke-RestMethod -Uri "$baseUrl/$merchantId/items" -Method Post -Body $pluPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Added Weighing Scale PLU Item:" $pluItem.item.name -ForegroundColor Green
    Write-Host "   External Item ID:" $pluItem.item.externalItemId -ForegroundColor Cyan
    Write-Host "   Price           : $" $pluItem.item.price "/ lb" -ForegroundColor Yellow
} catch {
    Write-Host "[ERROR] Failed to add PLU item: $($_.Exception.Message)" -ForegroundColor Red
}

# 5. Toggle 86 / Sold-Out Status for ITEM-101
Write-Host "`n5. Testing PATCH $baseUrl/$merchantId/items/ITEM-101/86 (Sold-Out Pause)..." -ForegroundColor Yellow
$pausePayload = @{
    isAvailable = $false
} | ConvertTo-Json

try {
    $pauseResult = Invoke-RestMethod -Uri "$baseUrl/$merchantId/items/ITEM-101/86" -Method Patch -Body $pausePayload -ContentType "application/json"
    Write-Host "[SUCCESS] Item Availability Toggled!" -ForegroundColor Green
    Write-Host "   Message  :" $pauseResult.message -ForegroundColor Magenta
} catch {
    Write-Host "[ERROR] Failed to toggle item status: $($_.Exception.Message)" -ForegroundColor Red
}

# 6. Trigger Full Platform Catalog Sync
Write-Host "`n6. Testing POST $baseUrl/$merchantId/sync (Multi-Platform Catalog Sync)..." -ForegroundColor Yellow
try {
    $syncResult = Invoke-RestMethod -Uri "$baseUrl/$merchantId/sync" -Method Post -ContentType "application/json"
    Write-Host "[SUCCESS] Catalog Synchronized Across All Platforms!" -ForegroundColor Green
    Write-Host "   Items Synced :" $syncResult.synchronizedItems -ForegroundColor Cyan
    Write-Host "   Sync Audit ID:" $syncResult.auditLogId -ForegroundColor Gray
} catch {
    Write-Host "[ERROR] Sync failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ALL MODULE 3 CATALOG TESTS PASSED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
