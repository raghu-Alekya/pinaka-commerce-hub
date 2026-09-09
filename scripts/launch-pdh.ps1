param([switch]$Restart, [switch]$SkipDocker)
$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$logRoot = Join-Path $serviceRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$services = @(
    @{Name='gateway';Port=3000}, @{Name='connector-service';Port=3001},
    @{Name='order-service';Port=3002}, @{Name='merchant-service';Port=3003},
    @{Name='menu-service';Port=3004}, @{Name='inventory-service';Port=3005},
    @{Name='analytics-service';Port=3006}, @{Name='pos-integration-service';Port=3007},
    @{Name='notification-service';Port=3008}, @{Name='admin-api';Port=3009},
    @{Name='auth-service';Port=3010}
)
# Serialize launches so repeated clicks cannot start competing service copies.
$launchMutex = New-Object System.Threading.Mutex($false, 'Local\PinakaCommerceHubLauncher')
if (-not $launchMutex.WaitOne(0)) { throw 'The local service launcher is already running.' }
try {
    if (-not $SkipDocker) {
        & docker compose --project-directory $serviceRoot -f (Join-Path $serviceRoot 'docker-compose.yml') up -d
        if ($LASTEXITCODE -ne 0) { throw 'Docker startup failed.' }
    }
    foreach ($service in $services) {
        $entry = Join-Path $serviceRoot "apps/$($service.Name)/src/main.ts"
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $service.Port)
        if ($listeners.Count) {
            $owners = @($listeners.OwningProcess | Select-Object -Unique)
            foreach ($owner in $owners) {
                $process = Get-CimInstance Win32_Process -Filter "ProcessId = $owner"
                $normalized = $process.CommandLine -replace '\\', '/'
                $absoluteEntry = $entry -replace '\\', '/'
                # Relative entry points are also used by this project's original launcher.
                $relativeEntry = "apps/$($service.Name)/src/main.ts"
                $matchesService = $process.Name -eq 'node.exe' -and ($normalized.Contains($absoluteEntry) -or $normalized -match ('(?:\s|"|\x27)' + [regex]::Escape($relativeEntry) + '(?:\s|"|\x27|$)'))
                if (-not $matchesService) { throw "Port $($service.Port) belongs to another process (PID $owner). It was not stopped." }
                if ($Restart) { Stop-Process -Id $owner -ErrorAction Stop }
            }
            if (-not $Restart) {
                Write-Host "$($service.Name): already running on $($service.Port); reused."
                continue
            }
            $releaseDeadline = (Get-Date).AddSeconds(10)
            while (@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq $service.Port).Count) {
                if ((Get-Date) -gt $releaseDeadline) { throw "Port $($service.Port) did not become free." }
                Start-Sleep -Milliseconds 200
            }
        }
        $started = Start-Process -FilePath $nodeExecutable -ArgumentList @('--import','tsx',('"' + $entry + '"')) -WorkingDirectory $serviceRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot "$($service.Name).out.log") -RedirectStandardError (Join-Path $logRoot "$($service.Name).err.log")
        $readyDeadline = (Get-Date).AddSeconds(25)
        do {
            Start-Sleep -Milliseconds 300
            $started.Refresh()
            if ($started.HasExited) { throw "$($service.Name) exited. See logs/$($service.Name).err.log." }
            $ready = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq $service.Port -and $_.OwningProcess -eq $started.Id }).Count -gt 0
        } until ($ready -or (Get-Date) -gt $readyDeadline)
        if (-not $ready) { throw "$($service.Name) did not bind port $($service.Port). Check its logs before retrying." }
        Write-Host "$($service.Name): ready on $($service.Port) (PID $($started.Id))."
    }
    Write-Host 'Backend ready: ports 3000-3010. Docker PostgreSQL: 127.0.0.1:5432.'
    Write-Host 'React: http://localhost:5173 (start npm run dev in pinaka-commerce-hub-web).'
    Write-Host 'Re-running this command reuses existing services. Add -Restart to reload backend services.'
} finally {
    $launchMutex.ReleaseMutex()
    $launchMutex.Dispose()
}
