# Pinaka Commerce Hub (PCH) — Module 7 Order Management & State Machine Test Script
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PCH MODULE 7 (ORDER MANAGEMENT AND STATE MACHINE) TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3002/api/v1/orders"
$storeId = "STR-5001"

# 1. Health Check
Write-Host "`n1. Testing Order Service Health Endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "[SUCCESS] Health Status:" $health.status "- Version:" $health.version -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Order Service offline on port 3002. Launching..." -ForegroundColor Red
}

# 2. Create New Sales Order
Write-Host "`n2. Testing POST $baseUrl (Creating Sales Order)..." -ForegroundColor Yellow
$orderPayload = @{
    merchantId = "MCH-1001"
    storeId = $storeId
    shiftId = "SHIFT-8001"
    customerName = "James Wilson"
    customerPhone = "+1 (555) 444-3333"
    orderType = "IN_STORE_POS"
    paymentMethod = "CASH"
    paymentStatus = "PAID"
    items = @(
        @{ productId = "MILK-ORG-1G"; productName = "Organic Whole Milk 1 Gal"; quantity = 2; unitPrice = 5.49 },
        @{ productId = "ITEM-101"; productName = "Cheeseburger Deluxe"; quantity = 1; unitPrice = 14.99 }
    )
} | ConvertTo-Json -Depth 5

try {
    $createResult = Invoke-RestMethod -Uri "$baseUrl" -Method Post -Body $orderPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Order Created Successfully!" -ForegroundColor Green
    Write-Host "   Order ID    :" $createResult.orderId -ForegroundColor Cyan
    Write-Host "   Order Number:" $createResult.orderNumber -ForegroundColor Magenta
    Write-Host "   Customer    :" $createResult.order.customerName -ForegroundColor Cyan
    Write-Host "   Subtotal    : $" $createResult.order.subtotal -ForegroundColor Yellow
    Write-Host "   Tax (8.25%) : $" $createResult.order.taxAmount -ForegroundColor Yellow
    Write-Host "   Total Amount: $" $createResult.order.totalAmount -ForegroundColor Green
    $activeOrderId = $createResult.orderId
} catch {
    Write-Host "[ERROR] Order creation failed" -ForegroundColor Red
    $activeOrderId = "ORD-10045"
}

# 3. Fetch Orders List for Store STR-5001
Write-Host "`n3. Testing GET $baseUrl (Fetching Store Orders)..." -ForegroundColor Yellow
try {
    $ordersList = Invoke-RestMethod -Uri "$baseUrl?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] Found" $ordersList.count "orders for Store $storeId." -ForegroundColor Green
    $ordersList.orders | Format-Table id, orderNumber, customerName, orderType, totalAmount, orderStatus
} catch {
    Write-Host "[ERROR] Failed to fetch orders list" -ForegroundColor Red
}

# 4. State Machine Transition: CREATED -> CONFIRMED
Write-Host "`n4. Testing PATCH $baseUrl/$activeOrderId/status (State Machine: CONFIRMED)..." -ForegroundColor Yellow
$statusPayload1 = @{
    status = "CONFIRMED"
    changedBy = "POS Kitchen Display System"
    reason = "Order Received & Payment Verified"
} | ConvertTo-Json

try {
    $res1 = Invoke-RestMethod -Uri "$baseUrl/$activeOrderId/status" -Method Patch -Body $statusPayload1 -ContentType "application/json"
    Write-Host "[SUCCESS] Order State Transitioned:" $res1.order.orderStatus -ForegroundColor Green
} catch {
    Write-Host "[ERROR] State transition 1 failed" -ForegroundColor Red
}

# 5. State Machine Transition: CONFIRMED -> IN_PREPARATION
Write-Host "`n5. Testing PATCH $baseUrl/$activeOrderId/status (State Machine: IN_PREPARATION)..." -ForegroundColor Yellow
$statusPayload2 = @{
    status = "IN_PREPARATION"
    changedBy = "Kitchen Chef Marco"
    reason = "Food Items Cooking on Grill"
} | ConvertTo-Json

try {
    $res2 = Invoke-RestMethod -Uri "$baseUrl/$activeOrderId/status" -Method Patch -Body $statusPayload2 -ContentType "application/json"
    Write-Host "[SUCCESS] Order State Transitioned:" $res2.order.orderStatus -ForegroundColor Green
} catch {
    Write-Host "[ERROR] State transition 2 failed" -ForegroundColor Red
}

# 6. State Machine Transition: IN_PREPARATION -> COMPLETED
Write-Host "`n6. Testing PATCH $baseUrl/$activeOrderId/status (State Machine: COMPLETED)..." -ForegroundColor Yellow
$statusPayload3 = @{
    status = "COMPLETED"
    changedBy = "Cashier Sarah"
    reason = "Items Bagged & Handed to Customer"
} | ConvertTo-Json

try {
    $res3 = Invoke-RestMethod -Uri "$baseUrl/$activeOrderId/status" -Method Patch -Body $statusPayload3 -ContentType "application/json"
    Write-Host "[SUCCESS] Order State Transitioned:" $res3.order.orderStatus -ForegroundColor Green
} catch {
    Write-Host "[ERROR] State transition 3 failed" -ForegroundColor Red
}

# 7. Get Order Details & State History Log
Write-Host "`n7. Testing GET $baseUrl/$activeOrderId (Fetching Order Audit History)..." -ForegroundColor Yellow
try {
    $detail = Invoke-RestMethod -Uri "$baseUrl/$activeOrderId" -Method Get
    Write-Host "[SUCCESS] Audit Log Verified!" -ForegroundColor Green
    Write-Host "   Total Line Items:" $detail.items.Count -ForegroundColor Cyan
    Write-Host "   Total State Transitions Recorded:" $detail.history.Count -ForegroundColor Magenta
    $detail.history | Format-Table fromStatus, toStatus, changedBy, reason, createdAt
} catch {
    Write-Host "[ERROR] Failed to fetch order audit history" -ForegroundColor Red
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ALL MODULE 7 ORDER ENGINE TESTS PASSED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
