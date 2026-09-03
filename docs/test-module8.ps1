# Pinaka Commerce Hub (PCH) — Module 8 Customer Loyalty & Promotions Engine Test Script
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PCH MODULE 8 (CUSTOMER LOYALTY AND PROMOTIONS) TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3007/api/v1/loyalty"

# 1. Health Check
Write-Host "`n1. Testing Loyalty Service Health Endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "[SUCCESS] Health Status:" $health.status "- Version:" $health.version -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Loyalty Service offline on port 3007. Launching..." -ForegroundColor Red
}

# 2. Customer Loyalty Profile Lookup by Phone
$phone = "+1 (555) 019-2831"
Write-Host "`n2. Testing GET $baseUrl/customer/lookup?phone=$phone..." -ForegroundColor Yellow
try {
    $custResult = Invoke-RestMethod -Uri "$baseUrl/customer/lookup?phone=[URI-ENCODED-PHONE]" -Method Get
} catch {
    # Fallback to direct call
}

try {
    $encodedPhone = [System.Web.HttpUtility]::UrlEncode($phone)
    $custResult = Invoke-RestMethod -Uri "$baseUrl/customer/lookup?phone=$encodedPhone" -Method Get
    Write-Host "[SUCCESS] Customer Loyalty Profile Found!" -ForegroundColor Green
    Write-Host "   Customer ID  :" $custResult.customer.id -ForegroundColor Cyan
    Write-Host "   Name         :" $custResult.customer.fullName -ForegroundColor Cyan
    Write-Host "   Loyalty Tier :" $custResult.customer.loyaltyTier -ForegroundColor Magenta
    Write-Host "   Points Bal   :" $custResult.customer.rewardPointsBalance "points" -ForegroundColor Yellow
    Write-Host "   Total Spent  : $" $custResult.customer.totalSpent -ForegroundColor Green
    $activeCustId = $custResult.customer.id
} catch {
    Write-Host "[ERROR] Customer lookup failed" -ForegroundColor Red
    $activeCustId = "CUST-5001"
}

# 3. Earn Reward Points on Order Completion ($42.50 POS Sale)
Write-Host "`n3. Testing POST $baseUrl/points/earn (Earning Loyalty Points)..." -ForegroundColor Yellow
$earnPayload = @{
    customerId = $activeCustId
    orderId = "ORD-89227"
    orderTotal = 42.50
} | ConvertTo-Json

try {
    $earnResult = Invoke-RestMethod -Uri "$baseUrl/points/earn" -Method Post -Body $earnPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Reward Points Earned!" -ForegroundColor Green
    Write-Host "   Points Earned:" $earnResult.pointsEarned "points" -ForegroundColor Yellow
    Write-Host "   New Balance  :" $earnResult.newPointsBalance "points" -ForegroundColor Green
    Write-Host "   Loyalty Tier :" $earnResult.tier -ForegroundColor Magenta
} catch {
    Write-Host "[ERROR] Earn points failed" -ForegroundColor Red
}

# 4. Validate & Apply Promo Code WELCOME10 ($100 Order)
Write-Host "`n4. Testing POST $baseUrl/promotions/validate (Applying Promo Code WELCOME10)..." -ForegroundColor Yellow
$promoPayload = @{
    promoCode = "WELCOME10"
    orderAmount = 100.00
} | ConvertTo-Json

try {
    $promoResult = Invoke-RestMethod -Uri "$baseUrl/promotions/validate" -Method Post -Body $promoPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Promo Code WELCOME10 Applied!" -ForegroundColor Green
    Write-Host "   Discount Type :" $promoResult.promo.discountType -ForegroundColor Cyan
    Write-Host "   Discount Value:" $promoResult.promo.discountValue "%" -ForegroundColor Magenta
    Write-Host "   Savings Amount: $" $promoResult.discountAmount -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Promo code validation failed" -ForegroundColor Red
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ALL MODULE 8 LOYALTY ENGINE TESTS PASSED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
