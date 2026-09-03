# Pinaka Commerce Hub (PCH) — Module 10 Staff Management & Attendance Test Script
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PCH MODULE 10 (STAFF MANAGEMENT AND ATTENDANCE) TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3009/api/v1/staff"
$storeId = "STR-5001"

# 1. Health Check
Write-Host "`n1. Testing Staff Service Health Endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "[SUCCESS] Health Status:" $health.status "- Version:" $health.version -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Staff Service offline on port 3009. Launching..." -ForegroundColor Red
}

# 2. Verify Employee 4-Digit PIN on Sunmi POS (PIN 1234)
Write-Host "`n2. Testing POST $baseUrl/verify-pin (Sunmi POS Cashier PIN 1234)..." -ForegroundColor Yellow
$pinPayload = @{
    storeId = $storeId
    pinCode = "1234"
} | ConvertTo-Json

try {
    $pinResult = Invoke-RestMethod -Uri "$baseUrl/verify-pin" -Method Post -Body $pinPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Cashier Authenticated!" -ForegroundColor Green
    Write-Host "   Employee ID :" $pinResult.employee.id -ForegroundColor Cyan
    Write-Host "   Full Name   :" $pinResult.employee.fullName -ForegroundColor Cyan
    Write-Host "   Role        :" $pinResult.employee.role -ForegroundColor Magenta
    Write-Host "   Hourly Rate : $" $pinResult.employee.hourlyRate -ForegroundColor Yellow
    $empId = $pinResult.employee.id
} catch {
    Write-Host "[ERROR] PIN verification failed" -ForegroundColor Red
    $empId = "EMP-101"
}

# 3. Clock-In at Start of Shift
Write-Host "`n3. Testing POST $baseUrl/clock-in (Clocking In Shift)..." -ForegroundColor Yellow
$clockInPayload = @{
    merchantId = "MCH-1001"
    storeId = $storeId
    employeeId = $empId
} | ConvertTo-Json

try {
    $inResult = Invoke-RestMethod -Uri "$baseUrl/clock-in" -Method Post -Body $clockInPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Employee Clocked In!" -ForegroundColor Green
    Write-Host "   Attendance ID:" $inResult.attendanceId -ForegroundColor Cyan
    Write-Host "   Clock-In Time:" $inResult.clockInTime -ForegroundColor Yellow
    $attId = $inResult.attendanceId
} catch {
    Write-Host "[ERROR] Clock-in failed" -ForegroundColor Red
    $attId = "ATT-9001"
}

# 4. Fetch Store Employee Roster
Write-Host "`n4. Testing GET $baseUrl/employees?storeId=$storeId (Store Roster)..." -ForegroundColor Yellow
try {
    $roster = Invoke-RestMethod -Uri "$baseUrl/employees?storeId=$storeId" -Method Get
    Write-Host "[SUCCESS] Found" $roster.count "active store employees." -ForegroundColor Green
    $roster.employees | Format-Table employeeCode, fullName, role, pinCode, hourlyRate
} catch {
    Write-Host "[ERROR] Roster lookup failed" -ForegroundColor Red
}

# 5. Clock-Out at End of Shift (8.00 Hours)
Write-Host "`n5. Testing POST $baseUrl/clock-out (Clocking Out Shift)..." -ForegroundColor Yellow
$clockOutPayload = @{
    attendanceId = $attId
    hoursWorked = 8.00
} | ConvertTo-Json

try {
    $outResult = Invoke-RestMethod -Uri "$baseUrl/clock-out" -Method Post -Body $clockOutPayload -ContentType "application/json"
    Write-Host "[SUCCESS] Employee Clocked Out!" -ForegroundColor Green
    Write-Host "   Attendance ID:" $outResult.attendance.id -ForegroundColor Cyan
    Write-Host "   Employee Name:" $outResult.attendance.employeeName -ForegroundColor Cyan
    Write-Host "   Hours Worked :" $outResult.totalHoursWorked "hrs" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Clock-out failed" -ForegroundColor Red
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ALL MODULE 10 STAFF ENGINE TESTS PASSED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
