# Start Chrome with remote debugging for mall-brand-cycle --connect
# CRITICAL: profile path must be quoted (spaces in "Jeremy Tan" break CDP otherwise).
#
# Usage (from repo root or anywhere):
#   powershell -ExecutionPolicy Bypass -File scripts\start-shopee-chrome-cdp.ps1

$ErrorActionPreference = 'Stop'
# This file lives in scripts/ → repo root is parent
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ProfileDir = Join-Path $Root '.shopee-chrome-profile'
$Port = 9222

Write-Host "=== Start Shopee Chrome (CDP :$Port) ==="
Write-Host "Profile: $ProfileDir"

# 1) Full kill — Windows reuses first Chrome and ignores --remote-debugging-port
$procs = Get-Process chrome -ErrorAction SilentlyContinue
if ($procs) {
  Write-Host "Stopping $($procs.Count) Chrome process(es)..."
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

# 2) Stale singleton / port files
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
foreach ($name in @('SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort')) {
  $f = Join-Path $ProfileDir $name
  if (Test-Path $f) {
    Remove-Item $f -Force -ErrorAction SilentlyContinue
    Write-Host "Removed $name"
  }
}

$chrome = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) {
  $chrome = Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'
}
if (-not (Test-Path $chrome)) {
  Write-Error 'chrome.exe not found'
}

# 3) Quote path with spaces — THIS is what was broken before
$argString = @(
  "--remote-debugging-port=$Port"
  '--remote-debugging-address=127.0.0.1'
  "--user-data-dir=`"$ProfileDir`""
  '--no-first-run'
  '--no-default-browser-check'
  '--disable-background-networking'
  'https://shopee.sg/'
) -join ' '

Write-Host "Launch: $chrome $argString"
Start-Process -FilePath $chrome -ArgumentList $argString

Write-Host 'Waiting for http://127.0.0.1:9222/json/version ...'
$ok = $false
for ($n = 1; $n -le 20; $n++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 2
    Write-Host "CDP OK (attempt $n)"
    Write-Host $r.Content
    $ok = $true
    break
  } catch {
    Write-Host "  attempt $n ..."
  }
}

if (-not $ok) {
  Write-Host ''
  Write-Host 'FAILED: nothing on port 9222.'
  Write-Host 'Check Task Manager — all chrome.exe must be gone before launch.'
  Write-Host 'If still failing, try a short profile path, e.g. C:\shopee-cdp'
  exit 1
}

Write-Host ''
Write-Host 'SUCCESS. In THIS Chrome window: log into shopee.sg (keep it open).'
Write-Host 'Then run harvest with --connect, e.g.:'
Write-Host ''
Write-Host '  node scripts/mall-brand-cycle.mjs -w c21c057f-ea01-4e19-bc79-fafcf2626b19 --brand biodance --connect --list-mode all --max-pages 2 --skip-mh4 --no-notify'
Write-Host ''
