# Launches two instances of the packaged (uninstalled) build side by side so the
# presenter/viewer SignalR session can be tested locally.
#
#   npm run package         # build once
#   ./scripts/run-two-packaged.ps1
#
# Two things a packaged build needs that dev mode gets for free:
#   * SignalR creds — packaged builds don't read .env, so we load it here and
#     forward it via SIGNALR_CONNECTION_STRING (which config.ts reads in any mode).
#   * The single-instance lock forbids a second app; ELECTRON_UNITY_ALLOW_MULTI=1
#     opts out (see src/main/index.ts).
# Each instance gets its own --user-data-dir so their Chromium caches don't fight.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe  = Join-Path $root 'out\electron-unity-win32-x64\electron-unity.exe'

if (-not (Test-Path $exe)) {
  throw "Packaged build not found at $exe. Run 'npm run package' first."
}

# Pull SignalR config out of .env so the secret stays in one place.
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $idx = $line.IndexOf('=')
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim()
    if ($key -eq 'SIGNALR_CONNECTION_STRING' -or $key -eq 'SIGNALR_HUB') {
      Set-Item -Path "env:$key" -Value $val
    }
  }
}

if (-not $env:SIGNALR_CONNECTION_STRING) {
  throw "SIGNALR_CONNECTION_STRING not set. Add it to .env or the environment."
}

$env:ELECTRON_UNITY_ALLOW_MULTI = '1'

$dataA = Join-Path $env:TEMP 'electron-unity-test\instance-a'
$dataB = Join-Path $env:TEMP 'electron-unity-test\instance-b'
New-Item -ItemType Directory -Force -Path $dataA, $dataB | Out-Null

Write-Host "Launching instance A..."
Start-Process -FilePath $exe -ArgumentList "--user-data-dir=$dataA"
Start-Sleep -Seconds 2
Write-Host "Launching instance B..."
Start-Process -FilePath $exe -ArgumentList "--user-data-dir=$dataB"

Write-Host ""
Write-Host "Both running. In one window press Present to get a 6-char code;"
Write-Host "in the other, join with that code (or pick it from the lobby)."
