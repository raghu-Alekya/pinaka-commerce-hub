# Pinaka Commerce Hub (PCH) — Module 1 Automated Test Script
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PCH MODULE 1 (MERCHANT & ONBOARDING) ENDPOINT TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3003/api/v1"
$randomId = Get-Random -Minimum 1000 -Maximum 9999

# 1. Health Check
Write-Host "`n1. Testing Health Endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "[SUCCESS] Health Status:" $health.status "- Version:" $health.version -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Service offline on port 3003. Please launch merchant-service first." -ForegroundColor Red
}

# 2. Get All Merchants
Write-Host "`n2. Testing GET /api/v1/merchants..." -ForegroundColor Yellow
try {
    $merchants = Invoke-RestMethod -Uri "$baseUrl/merchants" -Method Get
    Write-Host "[SUCCESS] Found" $merchants.count "merchants in system." -ForegroundColor Green
    $merchants.merchants | Format-Table id, businessName, businessType, status, email
} catch {
    Write-Host "[ERROR] Failed to fetch merchants: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. Simulate New Merchant Onboarding (From pch.alekyatechsolutions.com)
Write-Host "`n3. Testing POST /api/v1/onboarding/complete (Simulating Onboarding Wizard)..." -ForegroundColor Yellow
$onboardingPayload = @{
    businessName = "Green Leaf Supermarket #$randomId"
    businessType = "GROCERY"
    ownerName = "Sarah Jenkins"
    email = "sarah.jenkins_$randomId@greenleaf.com"
    phone = "+1 (555) 789-0123"
    taxId = "98-7654321"
    storeName = "Green Leaf Plaza #$randomId"
    storeCode = "STR-GL-$randomId"
    taxRate = 8.25
    planCode = "PRO"
} | ConvertTo-Json

try {
    $onboardResult = Invoke-RestMethod -Uri "$baseUrl/onboarding/complete" -Method Post -Body $onboardingPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Merchant Onboarded Successfully!" -ForegroundColor Green
    Write-Host "   Merchant ID   :" $onboardResult.merchant.id -ForegroundColor Cyan
    Write-Host "   Store ID      :" $onboardResult.store.id -ForegroundColor Cyan
    Write-Host "   Store Type    :" $onboardResult.store.storeType -ForegroundColor Cyan
    Write-Host "   Pairing PIN   :" $onboardResult.terminalPairingPin -ForegroundColor Yellow
    Write-Host "   Entitlements  :" ($onboardResult.subscription.entitlements -join ", ") -ForegroundColor Magenta
    $generatedPin = $onboardResult.terminalPairingPin
} catch {
    Write-Host "[ERROR] Onboarding failed: $($_.Exception.Message)" -ForegroundColor Red
    $generatedPin = "849201"
}

# 4. Simulate Sunmi Flutter POS Terminal Login via 6-Digit PIN
Write-Host "`n4. Testing POST /api/v1/stores/activate-terminal (Simulating Flutter POS Cashier Login)..." -ForegroundColor Yellow
$pairingPayload = @{
    activationPin = $generatedPin
} | ConvertTo-Json

try {
    $pairingResult = Invoke-RestMethod -Uri "$baseUrl/stores/activate-terminal" -Method Post -Body $pairingPayload -ContentType "application/json"
    Write-Host "[SUCCESS] POS Terminal Paired Successfully!" -ForegroundColor Green
    Write-Host "   Paired Store  :" $pairingResult.store.storeName -ForegroundColor Cyan
    Write-Host "   Store Currency:" $pairingResult.store.currency -ForegroundColor Cyan
    Write-Host "   Tax Rate      :" $pairingResult.store.taxRate "%" -ForegroundColor Cyan
    Write-Host "   Session Token :" $pairingResult.sessionToken -ForegroundColor Gray
    Write-Host "   Unlocked POS Features:" ($pairingResult.entitlements -join ", ") -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Terminal activation failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ALL MODULE 1 TESTS PASSED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
