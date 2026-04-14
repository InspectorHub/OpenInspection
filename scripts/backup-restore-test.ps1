# Backup & Restore E2E Test Suite Orchestrator

$ErrorActionPreference = "Stop"
cd "d:\Code\inspectorhub\apps\core"

$ConfigArgs = $args
if ($ConfigArgs.Length -eq 0) {
    # Default to standalone testing if no args provided
    $ConfigArgs = @()
}

function Log($msg) {
    Write-Host "`n>>> $msg" -ForegroundColor Cyan
}

try {
    # Phase 0: Pre-flight Teardown (Ensure clean start)
    Log "Phase 0: Ensuring a clean starting environment..."
    npm run teardown:cloudflare -- --force $ConfigArgs
    Log "Waiting 30 seconds for Cloudflare resource deletion to propagate..."
    Start-Sleep -Seconds 30

    # Phase 1: Clean Deployment
    Log "Phase 1: Performing initial clean setup on Cloudflare (with retries)..."
    $maxRetries = 3
    $retryCount = 0
    $workerUrl = $null
    while ($null -eq $workerUrl -and $retryCount -lt $maxRetries) {
        try {
            $setupOutput = npm run setup:cloudflare -- --force $ConfigArgs
            $workerUrl = ($setupOutput | Select-String "https://[a-z0-9.-]+\.workers\.dev").Matches.Value
        } catch {
            $retryCount++
            Log "Deployment attempt $retryCount failed. Retrying..."
            Start-Sleep -Seconds 5
        }
    }
    
    if (-not $workerUrl) {
        throw "Could not find Worker URL in setup output after $maxRetries attempts."
    }
    Log "Worker URL detected: $workerUrl"

    # Phase 2: Data Seeding
    Log "Phase 2: Seeding data via Playwright..."
    $env:BASE_URL = $workerUrl
    npx playwright test tests/backup-restore-seed.spec.ts --project=chromium

    # Phase 3: Backup
    Log "Phase 3: Backing up remote resources..."
    npm run backup -- $ConfigArgs

    # Phase 4: Teardown
    Log "Phase 4: Tearing down infrastructure..."
    npm run teardown:cloudflare -- --force $ConfigArgs
    Log "Waiting 30 seconds for Cloudflare resource deletion to propagate..."
    Start-Sleep -Seconds 30

    # Phase 5: Redemption (Clean Deploy)
    Log "Phase 5: Re-deploying fresh infrastructure (with retries)..."
    $retryCount2 = 0
    $workerUrl2 = $null
    while ($null -eq $workerUrl2 -and $retryCount2 -lt $maxRetries) {
        try {
            $setupOutput2 = npm run setup:cloudflare -- --force $ConfigArgs
            $workerUrl2 = ($setupOutput2 | Select-String "https://[a-z0-9.-]+\.workers\.dev").Matches.Value
        } catch {
            $retryCount2++
            Log "Deployment attempt $retryCount2 failed. Retrying..."
            Start-Sleep -Seconds 5
        }
    }
    if (-not $workerUrl2) {
        throw "Could not find Worker URL in setup output after $maxRetries attempts."
    }
    Log "Worker URL detected: $workerUrl2"

    # Phase 6: Restore
    Log "Phase 6: Restoring data from latest backup..."
    npm run restore -- --yes $ConfigArgs

    # Phase 7: Verification
    Log "Phase 7: Verifying data integrity via Playwright (waiting 60s for DNS)..."
    Start-Sleep -Seconds 60
    $env:BASE_URL = $workerUrl2
    npx playwright test tests/backup-restore-verify.spec.ts --project=chromium

    Log "SUCCESS: Backup and Restore validation passed!"
} catch {
    Write-Error "Test Suite FAILED: $($_.Exception.Message)"
    exit 1
}
