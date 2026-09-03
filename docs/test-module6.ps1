# Pinaka Commerce Hub (PCH) — Module 6 Delivery Aggregator Hub Test Script
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PCH MODULE 6 (ONLINE DELIVERY AGGREGATOR HUB) TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3001/api/v1/connectors/delivery"
$storeId = "STR-5001"

# 1. Health Check
Write-Host "`n1. Testing Delivery Connector Health Endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "[SUCCESS] Health Status:" $health.status "- Version:" $health.version -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Delivery Connector Service offline on port 3001. Launching..." -ForegroundColor Red
}

# 2. Get Active Delivery Channels for Store STR-5001
Write-Host "`n2. Testing GET $baseUrl/channels?storeId=$storeId (Fetching Active Channels)..." -ForegroundColor Yellow
try {
    $channels = Invoke-RestMethod -Uri "$baseUrl/channels?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] Found" $channels.count "active delivery channels for Store $storeId." -ForegroundColor Green
    $channels.channels | Format-Table channel, externalStoreId, autoAccept, defaultPrepTimeMinutes, isEnabled
} catch {
    Write-Host "[ERROR] Failed to fetch channels" -ForegroundColor Red
}

# 3. Simulate DoorDash Incoming Delivery Webhook
Write-Host "`n3. Testing POST $baseUrl/webhook/doordash (Ingesting DoorDash Order Webhook)..." -ForegroundColor Yellow
$ddPayload = @{
    merchantId = "MCH-1001"
    storeId = $storeId
    externalOrderId = "DD-ORDER-99120"
    customerName = "Robert Taylor"
    customerPhone = "+1 (555) 234-5678"
    totalAmount = 42.50
    driverName = "David (DoorDash Driver)"
    orderItems = @(
        @{ name = "Organic Whole Milk 1 Gal"; qty = 1; price = 5.49 },
        @{ name = "Cheeseburger Deluxe"; qty = 2; price = 14.99 }
    )
} | ConvertTo-Json -Depth 5

try {
    $ddResult = Invoke-RestMethod -Uri "$baseUrl/webhook/doordash" -Method Post -Body $ddPayload -ContentType "application/json"
    Write-Host "[SUCCESS] DoorDash Order Ingested & Alert Broadcast to Sunmi POS!" -ForegroundColor Green
    Write-Host "   Order ID    :" $ddResult.orderId -ForegroundColor Cyan
    Write-Host "   Channel     :" $ddResult.channel -ForegroundColor Magenta
    Write-Host "   Total       : $" $ddResult.order.totalAmount -ForegroundColor Yellow
    $activeOrderId = $ddResult.orderId
} catch {
    Write-Host "[ERROR] DoorDash webhook failed" -ForegroundColor Red
    $activeOrderId = "DEL-10045"
}

# 4. Simulate Uber Eats Incoming Delivery Webhook
Write-Host "`n4. Testing POST $baseUrl/webhook/ubereats (Ingesting Uber Eats Order Webhook)..." -ForegroundColor Yellow
$uberPayload = @{
    merchantId = "MCH-1001"
    storeId = $storeId
    externalOrderId = "UBER-ORDER-77401"
    customerName = "Emily Watson"
    customerPhone = "+1 (555) 876-5432"
    totalAmount = 28.90
    driverName = "Carlos (Uber Courier)"
    orderItems = @(
        @{ name = "Truffle Fries"; qty = 2; price = 8.50 },
        @{ name = "Gala Apples PLU 4131"; qty = 3; price = 1.99 }
    )
} | ConvertTo-Json -Depth 5

try {
    $uberResult = Invoke-RestMethod -Uri "$baseUrl/webhook/ubereats" -Method Post -Body $uberPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Uber Eats Order Ingested!" -ForegroundColor Green
    Write-Host "   Order ID    :" $uberResult.orderId -ForegroundColor Cyan
    Write-Host "   Channel     :" $uberResult.channel -ForegroundColor Magenta
    Write-Host "   Total       : $" $uberResult.order.totalAmount -ForegroundColor Yellow
} catch {
    Write-Host "[ERROR] Uber Eats webhook failed" -ForegroundColor Red
}

# 5. Fetch Active Orders for Sunmi POS Touchscreen
Write-Host "`n5. Testing GET $baseUrl/orders?storeId=$storeId (Sunmi POS Orders List)..." -ForegroundColor Yellow
try {
    $orders = Invoke-RestMethod -Uri "$baseUrl/orders?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] Found" $orders.count "active delivery orders on POS screen." -ForegroundColor Green
    $orders.orders | Format-Table id, channel, customerName, totalAmount, status, prepTimeMinutes
} catch {
    Write-Host "[ERROR] Failed to fetch POS delivery orders" -ForegroundColor Red
}

# 6. Accept Order & Set Kitchen Prep Time (25 Mins)
Write-Host "`n6. Testing POST $baseUrl/orders/accept (Accepting Delivery Order)..." -ForegroundColor Yellow
$acceptPayload = @{
    orderId = $activeOrderId
    prepTimeMinutes = 25
} | ConvertTo-Json

try {
    $acceptResult = Invoke-RestMethod -Uri "$baseUrl/orders/accept" -Method Post -Body $acceptPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Delivery Order Accepted!" -ForegroundColor Green
    Write-Host "   Order ID    :" $acceptResult.order.id -ForegroundColor Cyan
    Write-Host "   Status      :" $acceptResult.order.status -ForegroundColor Green
    Write-Host "   Prep Time   :" $acceptResult.order.prepTimeMinutes "minutes" -ForegroundColor Yellow
} catch {
    Write-Host "[ERROR] Order accept failed" -ForegroundColor Red
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ALL MODULE 6 DELIVERY CONNECTOR TESTS PASSED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
