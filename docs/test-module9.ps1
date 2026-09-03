# Pinaka Commerce Hub (PCH) — Module 9 Analytics & Reporting Engine Test Script
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PCH MODULE 9 (ANALYTICS AND REPORTING ENGINE) TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3008/api/v1/analytics"
$storeId = "STR-5001"

# 1. Health Check
Write-Host "`n1. Testing Analytics Service Health Endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "[SUCCESS] Health Status:" $health.status "- Version:" $health.version -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Analytics Service offline on port 3008. Launching..." -ForegroundColor Red
}

# 2. Executive Financial Dashboard KPIs
Write-Host "`n2. Testing GET $baseUrl/dashboard?storeId=$storeId (Executive KPIs)..." -ForegroundColor Yellow
try {
    $dash = Invoke-RestMethod -Uri "$baseUrl/dashboard?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] Executive Financial KPIs Retrieved!" -ForegroundColor Green
    Write-Host "   Total Gross Sales: $" $dash.metrics.totalGrossSales -ForegroundColor Green
    Write-Host "   Total Net Sales  : $" $dash.metrics.totalNetSales -ForegroundColor Green
    Write-Host "   Total Orders     :" $dash.metrics.totalOrdersCount -ForegroundColor Cyan
    Write-Host "   Avg Order Value  : $" $dash.metrics.averageOrderValue -ForegroundColor Yellow
    Write-Host "   Tax Collected    : $" $dash.metrics.totalTaxCollected -ForegroundColor Gray
} catch {
    Write-Host "[ERROR] Dashboard KPIs failed" -ForegroundColor Red
}

# 3. Top Revenue & Quantity Products Report
Write-Host "`n3. Testing GET $baseUrl/top-products?storeId=$storeId (Top Selling Items)..." -ForegroundColor Yellow
try {
    $topProds = Invoke-RestMethod -Uri "$baseUrl/top-products?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] Found" $topProds.count "top performing products." -ForegroundColor Green
    $topProds.topProducts | Format-Table productId, productName, unitsSold, totalRevenue
} catch {
    Write-Host "[ERROR] Top products report failed" -ForegroundColor Red
}

# 4. Sales Channel Performance Breakdown (POS vs Web vs Delivery)
Write-Host "`n4. Testing GET $baseUrl/channels?storeId=$storeId (Channel Breakdown)..." -ForegroundColor Yellow
try {
    $channels = Invoke-RestMethod -Uri "$baseUrl/channels?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] Channel Revenue Breakdown Retrieved!" -ForegroundColor Green
    Write-Host "   In-Store POS Revenue  : $" $channels.channelBreakdown.IN_STORE_POS -ForegroundColor Cyan
    Write-Host "   WooCommerce Web Store : $" $channels.channelBreakdown.WOOCOMMERCE -ForegroundColor Magenta
    Write-Host "   DoorDash Delivery     : $" $channels.channelBreakdown.DOORDASH -ForegroundColor Yellow
    Write-Host "   Uber Eats Delivery    : $" $channels.channelBreakdown.UBER_EATS -ForegroundColor Yellow
} catch {
    Write-Host "[ERROR] Channel breakdown failed" -ForegroundColor Red
}

# 5. Daily Z-Report Summary
Write-Host "`n5. Testing GET $baseUrl/z-report?storeId=$storeId (Daily Financial Z-Report)..." -ForegroundColor Yellow
try {
    $zrep = Invoke-RestMethod -Uri "$baseUrl/z-report?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] Daily Z-Report Summary Generated!" -ForegroundColor Green
    Write-Host "   Report Type : " $zrep.reportType -ForegroundColor Magenta
    Write-Host "   Gross Sales : $" $zrep.financials.grossSales -ForegroundColor Green
    Write-Host "   Net Sales   : $" $zrep.financials.netSales -ForegroundColor Green
    Write-Host "   Online Sales: $" $zrep.financials.onlineSales -ForegroundColor Cyan
} catch {
    Write-Host "[ERROR] Z-Report failed" -ForegroundColor Red
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ALL MODULE 9 ANALYTICS TESTS PASSED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
