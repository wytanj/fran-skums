#Requires -Version 5.1
<#
.SYNOPSIS
  Task Scheduler entry for Fran weekly marketplace brand radar (PR-3).

.DESCRIPTION
  Calls scripts/windows-marketplace-weekly.mjs against production control plane.
  Collect is Windows Chrome + warm cookies (Track G); this script only orchestrates
  HTTP: scheduler-tick → process-jobs loop → metrics-tick → weekly-digest.

  stop_batch (captcha/login) breaks the collect loop only; metrics + digest ALWAYS run.
  Exit code 2 = stop_batch (refresh cookies, re-run -Resume).

.PARAMETER Resume
  After cookie refresh — re-run pipeline (re-enqueue via scheduler for due seeds).

.PARAMETER DryRun
  Plan only (no production HTTP).

.EXAMPLE
  # Task Scheduler action:
  powershell -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\fran-skums\scripts\windows-marketplace-weekly.ps1"

.EXAMPLE
  .\windows-marketplace-weekly.ps1 -Resume
#>
param(
  [switch]$Resume,
  [switch]$DryRun,
  [string]$BaseUrl = $env:SKUMS_API_BASE,
  [string]$Workspace = $env:MARKETPLACE_WORKSPACE_ID,
  [string]$MetricDate = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }

$Mjs = Join-Path $Root "scripts\windows-marketplace-weekly.mjs"
if (-not (Test-Path $Mjs)) {
  Write-Error "Missing $Mjs"
  exit 1
}

# Optional: load .env into process for Node
$EnvFile = Join-Path $Root ".env"
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $parts = $_.Split('=', 2)
    $k = $parts[0].Trim()
    $v = $parts[1].Trim().Trim('"').Trim("'")
    if (-not [string]::IsNullOrEmpty($k) -and -not (Test-Path "Env:$k")) {
      Set-Item -Path "Env:$k" -Value $v
    }
  }
}

if ($BaseUrl) { $env:SKUMS_API_BASE = $BaseUrl }
if ($Workspace) { $env:MARKETPLACE_WORKSPACE_ID = $Workspace }

$nodeArgs = @($Mjs)
if ($DryRun) { $nodeArgs += "--dry-run" }
if ($Resume) { $nodeArgs += "--resume" }
if ($MetricDate) { $nodeArgs += @("--metric-date", $MetricDate) }

Write-Host "[weekly] node $($nodeArgs -join ' ')"
& node @nodeArgs
exit $LASTEXITCODE
