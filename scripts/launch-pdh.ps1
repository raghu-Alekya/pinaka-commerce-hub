param(
    [switch]$Restart,
    [switch]$SkipDocker,
    [ValidateRange(1, 3600)]
    [int]$StartupTimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$logRoot = Join-Path $serviceRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
function Get-StartupDiagnostics([string]$Name) {
    foreach ($suffix in @('err', 'out')) {
        $path = Join-Path $logRoot "$Name.$suffix.log"
        "Log: $path"
        if (Test-Path -LiteralPath $path) {
            Get-Content -LiteralPath $path -Tail 20 -ErrorAction SilentlyContinue
        }
    }
}
$services = @(
    @{Name='gateway';Port=3000}, @{Name='connector-service';Port=3001},
    @{Name='order-service';Port=3002}, @{Name='merchant-service';Port=3003},
    @{Name='inventory-service';Port=3005},
    @{Name='analytics-service';Port=3006}, @{Name='pos-integration-service';Port=3007},
    @{Name='notification-service';Port=3008}, @{Name='admin-api';Port=3009},
    @{Name='auth-service';Port=3010}
)
# Serialize launches so repeated clicks cannot start competing service copies.
$launchMutex = New-Object System.Threading.Mutex($false, 'Local\PinakaCommerceHubLauncher')
if (-not $launchMutex.WaitOne(0)) { throw 'The local service launcher is already running.' }
try {
    if (-not $SkipDocker) {
        $dockerRunning = $false
        try {
            & docker info 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $dockerRunning = $true }
        } catch {}

        if ($dockerRunning) {
            $composeProjectDirectory = $serviceRoot
            $composeFiles = @((Join-Path $serviceRoot 'docker-compose.yml'))
            $composeProjectName = Split-Path -Leaf $serviceRoot

            $redisLabelsJson = & docker inspect --format '{{json .Config.Labels}}' pdh-redis 2>$null
            if ($LASTEXITCODE -eq 0) {
                $redisLabels = ($redisLabelsJson -join [Environment]::NewLine) | ConvertFrom-Json
                $existingProject = $redisLabels.'com.docker.compose.project'
                $existingDirectory = $redisLabels.'com.docker.compose.project.working_dir'
                $existingComposeFiles = @($redisLabels.'com.docker.compose.project.config_files' -split ',')
                $canReuseExistingProject = -not [string]::IsNullOrWhiteSpace($existingProject) -and
                    -not [string]::IsNullOrWhiteSpace($existingDirectory) -and
                    $existingComposeFiles.Count -gt 0

                foreach ($containerName in @('pdh-postgres', 'pdh-rabbitmq', 'pdh-redis-commander', 'pdh-pgadmin')) {
                    $containerLabelsJson = & docker inspect --format '{{json .Config.Labels}}' $containerName 2>$null
                    if ($LASTEXITCODE -ne 0) {
                        $canReuseExistingProject = $false
                        break
                    }
                    $containerLabels = ($containerLabelsJson -join [Environment]::NewLine) | ConvertFrom-Json
                    if ($containerLabels.'com.docker.compose.project' -ne $existingProject -or
                        $containerLabels.'com.docker.compose.project.working_dir' -ne $existingDirectory -or
                        $containerLabels.'com.docker.compose.project.config_files' -ne $redisLabels.'com.docker.compose.project.config_files') {
                        $canReuseExistingProject = $false
                        break
                    }
                }

                foreach ($composeFile in $existingComposeFiles) {
                    if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) {
                        $canReuseExistingProject = $false
                        break
                    }
                }

                if ($existingDirectory -ne $serviceRoot) {
                    if (-not $canReuseExistingProject) {
                        throw "A pdh-redis container already exists outside this Compose project, and its complete owning project could not be verified. It was left untouched. Start or stop that project explicitly, then retry."
                    }
                    $composeProjectDirectory = $existingDirectory
                    $composeFiles = $existingComposeFiles
                    $composeProjectName = $existingProject
                    Write-Host "Reusing existing PCH Docker project '$composeProjectName' from $composeProjectDirectory."
                }
            }

            $composeArgs = @('--project-directory', $composeProjectDirectory, '-p', $composeProjectName)
            foreach ($composeFile in $composeFiles) {
                $composeArgs += @('-f', $composeFile)
            }

            & docker compose @composeArgs up -d
            if ($LASTEXITCODE -ne 0) { throw 'Docker startup failed. Existing containers were not removed; check the Compose error above.' }
            $pgReady = $false
            for ($attempt = 1; $attempt -le 30; $attempt++) {
                & docker compose @composeArgs exec -T postgres pg_isready -U pdh_user | Out-Null
                if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
                Start-Sleep -Seconds 1
            }
            if (-not $pgReady) { throw 'Docker PostgreSQL did not become ready. Check docker compose logs postgres.' }
            $ensureDbSql = "SELECT 'CREATE DATABASE pinaka_commerce_hub' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pinaka_commerce_hub') \gexec"
            $ensureDbSql | & docker compose @composeArgs exec -T postgres psql -U pdh_user -d template1 -v ON_ERROR_STOP=1 | Out-Null
            $ensureDbNewSql = "SELECT 'CREATE DATABASE pinaka_commerce_hub_new' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pinaka_commerce_hub_new') \gexec"
            $ensureDbNewSql | & docker compose @composeArgs exec -T postgres psql -U pdh_user -d template1 -v ON_ERROR_STOP=1 | Out-Null

            $syncScript = Join-Path $serviceRoot 'scripts/sync-all-entities.ts'
            if (Test-Path -LiteralPath $syncScript -PathType Leaf) {
                Write-Host 'Synchronizing all entity schemas into pinaka_commerce_hub_new database...'
                pnpm exec tsx $syncScript
                if ($LASTEXITCODE -ne 0) { throw 'Entity schema synchronization failed.' }
            } else {
                Write-Warning "Entity schema synchronization skipped; script not found: $syncScript"
            }

            $seedScript = Join-Path $serviceRoot 'scripts/seed-via-typeorm.ts'
            if (Test-Path -LiteralPath $seedScript -PathType Leaf) {
                pnpm exec tsx $seedScript
                if ($LASTEXITCODE -ne 0) { throw 'Database seeding failed.' }
            } else {
                Write-Warning "Database seeding skipped; script not found: $seedScript"
            }
            Write-Host 'PostgreSQL ready: pinaka_commerce_hub & pinaka_commerce_hub_new (pgAdmin http://localhost:5050).'
        } else {
            Write-Host 'Docker daemon is not running. Checking local PostgreSQL service...'
            $pgLocalReady = $false
            try {
                $tcp = New-Object System.Net.Sockets.TcpClient
                $tcp.Connect('127.0.0.1', 5432)
                $tcp.Close()
                $pgLocalReady = $true
            } catch {}
            if ($pgLocalReady) {
                Write-Host 'Local PostgreSQL is running on port 5432. Proceeding with local database.'
            } else {
                throw 'Docker daemon is not running and local PostgreSQL (port 5432) is not accessible. Please start Docker Desktop or local PostgreSQL service.'
            }
        }
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
                $matchesService = $process.Name -eq 'node.exe' -and ($normalized.Contains($absoluteEntry) -or $normalized -match ('(?:/|\\|\s|"|\x27)' + [regex]::Escape($relativeEntry) + '(?:\s|"|\x27|$)'))
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
        Write-Host "$($service.Name): starting (PID $($started.Id)); waiting up to $StartupTimeoutSeconds seconds for port $($service.Port)."
        $readyDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
        do {
            Start-Sleep -Milliseconds 300
            $started.Refresh()
            if ($started.HasExited) {
                $diagnostics = (Get-StartupDiagnostics $service.Name) -join [Environment]::NewLine
                throw "$($service.Name) exited with code $($started.ExitCode).`n$diagnostics"
            }
            $ready = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq $service.Port -and $_.OwningProcess -eq $started.Id }).Count -gt 0
        } until ($ready -or (Get-Date) -gt $readyDeadline)
        if (-not $ready) {
            $diagnostics = (Get-StartupDiagnostics $service.Name) -join [Environment]::NewLine
            throw "$($service.Name) did not bind port $($service.Port) within $StartupTimeoutSeconds seconds. PID $($started.Id) is still running and may finish starting. Check the logs and process before retrying. For slow startup, increase -StartupTimeoutSeconds.`n$diagnostics"
        }
        Write-Host "$($service.Name): ready on $($service.Port) (PID $($started.Id))."
    }
    Write-Host 'Backend ready: configured services on ports 3000-3010 (3004 reserved for catalog-service). Docker PostgreSQL is published on port 5432.'
    Write-Host 'React: http://localhost:5173 (start npm run dev in pinaka-commerce-hub-web).'
    Write-Host 'Re-running this command reuses existing services. Add -Restart to reload backend services.'
} finally {
    $launchMutex.ReleaseMutex()
    $launchMutex.Dispose()
}
