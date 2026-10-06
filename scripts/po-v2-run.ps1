# One Windows entry for the PO competitive price matrix v2.
# Quote every path. The username contains a space.
#
#   powershell -ExecutionPolicy Bypass -File scripts\po-v2-run.ps1 -SkipHarvest
#   powershell -ExecutionPolicy Bypass -File scripts\po-v2-run.ps1 -Brands joocyee,tirtir
#   powershell -ExecutionPolicy Bypass -File scripts\po-v2-run.ps1 -PriceRefreshOnly
#
# -SkipHarvest skips Chrome. The iHerb read still needs Supabase env vars.
# Without -SkipHarvest this script stops every chrome.exe, then starts the CDP Chrome.

param(
  [switch]$SkipHarvest,
  [string]$Brands = '',
  [switch]$PriceRefreshOnly
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $Root

$Po = Join-Path $Root '.local\po-v2-inputs\po-competitive-match-pr1.csv'
$OutDir = Join-Path $Root '.local\po-v2'
$Xlsx = Join-Path $Root '.local\po-v2-inputs\mall-harvest-full.xlsx'
$XlsxSales = Join-Path $Root '.local\po-v2-inputs\mall-harvest-full-sales.xlsx'
$IherbOut = Join-Path $OutDir 'iherb-refresh.json'
$Csv = Join-Path $Root 'exports\po-competitive-match\po-competitive-match-v2.csv'

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

& node (Join-Path $Root 'scripts\po-v2-iherb-refresh.mjs') --po $Po --out $IherbOut
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $SkipHarvest) {
  Write-Host 'Stopping every chrome.exe, then starting the Shopee CDP Chrome on port 9222.'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\start-shopee-chrome-cdp.ps1')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $harvestArgs = @(
    (Join-Path $Root 'scripts\po-v2-shopee-mall-harvest.mjs'),
    '--po', $Po,
    '--connect', 'http://127.0.0.1:9222'
  )
  if ($PriceRefreshOnly) {
    $harvestArgs += '--price-refresh-only'
  } elseif ($Brands) {
    $harvestArgs += @('--brands', $Brands)
  }
  & node @harvestArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$matrixArgs = @(
  (Join-Path $Root 'scripts\po-v2-build-matrix.mjs'),
  '--po', $Po,
  '--iherb-refresh', $IherbOut,
  '--xlsx', $Xlsx,
  '--xlsx', $XlsxSales,
  '--out', $Csv
)

$latest = Get-ChildItem -LiteralPath $OutDir -Filter 'shopee-mall-*.json' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch 'dry-run' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($latest) {
  $matrixArgs += @('--shopee', $latest.FullName)
}

& node @matrixArgs
exit $LASTEXITCODE
