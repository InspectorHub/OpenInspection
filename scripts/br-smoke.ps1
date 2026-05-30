# Browser Run smoke probe — calls /api/admin/system/br-smoke and interprets
# the result. Use this before flipping `tenant_configs.enable_pdf_pipeline`
# to confirm Cloudflare Browser Run is provisioned for the account.
#
# Examples:
#   ./scripts/br-smoke.ps1 -Token $env:JWT
#   ./scripts/br-smoke.ps1 -BaseUrl https://api.your-domain.com -Token $env:JWT
#   ./scripts/br-smoke.ps1 -ProbeUrl https://api.your-domain.com/report/<tenant>/<id> -Token $env:JWT

param(
    [string]$BaseUrl = $env:BR_SMOKE_BASE_URL,
    [string]$Token   = $env:BR_SMOKE_TOKEN,
    [string]$ProbeUrl = "https://example.com",
    [switch]$DryRun
)

if (-not $BaseUrl) { $BaseUrl = "http://localhost:8788" }

if ($DryRun) {
    Write-Host "==> wrangler deploy --dry-run (binding validation)" -ForegroundColor Cyan
    npx wrangler deploy --dry-run 2>&1 | Tee-Object -Variable dryOut
    if ($LASTEXITCODE -ne 0) {
        Write-Host "wrangler dry-run failed — fix binding errors before probing BR." -ForegroundColor Red
        exit 1
    }
    if ($dryOut -match "browser") {
        Write-Host "[ok] dry-run mentions browser binding" -ForegroundColor Green
    }
    Write-Host ""
}

if (-not $Token) {
    Write-Host "Missing -Token. Pass an admin JWT (Bearer)." -ForegroundColor Red
    Write-Host "  - Sign in via /login on the deployed API, copy the __Host-inspector_token cookie value."
    Write-Host "  - Or: `$env:BR_SMOKE_TOKEN = '<jwt>'; ./scripts/br-smoke.ps1"
    exit 2
}

$url = "$BaseUrl/api/admin/system/br-smoke?url=" + [System.Web.HttpUtility]::UrlEncode($ProbeUrl)
Write-Host "==> GET $url" -ForegroundColor Cyan

try {
    $resp = Invoke-RestMethod -Uri $url -Headers @{ Authorization = "Bearer $Token" } -ErrorAction Stop
} catch {
    Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $status = [int]$_.Exception.Response.StatusCode
        Write-Host "HTTP $status" -ForegroundColor Red
        if ($status -eq 401) { Write-Host "Hint: token expired or not an admin user." -ForegroundColor Yellow }
        if ($status -eq 404) { Write-Host "Hint: br-smoke route not deployed yet. Run 'npm run deploy' first." -ForegroundColor Yellow }
    }
    exit 3
}

$d = $resp.data
Write-Host ""
Write-Host "bindingPresent : $($d.bindingPresent)"
Write-Host "probedUrl      : $($d.probedUrl)"
Write-Host "status         : $($d.status)"
Write-Host "ok             : $($d.ok)"
Write-Host "contentType    : $($d.contentType)"
Write-Host "contentLength  : $($d.contentLength) bytes"
Write-Host "durationMs     : $($d.durationMs)"
if ($d.error) { Write-Host "error          : $($d.error)" -ForegroundColor Yellow }
Write-Host ""
Write-Host "hint: $($d.hint)" -ForegroundColor $(if ($d.ok) { 'Green' } elseif ($d.bindingPresent) { 'Yellow' } else { 'Red' })

if (-not $d.ok) { exit 4 }
