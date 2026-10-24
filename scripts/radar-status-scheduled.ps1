# Scheduled wrapper for the read-only Early Radar liveness check.
# Appends one timestamped JSON block per run to logs/radar-status.log, then forwards the exit code.
# Exit 0 = fresh, 2 = stale, 1 = configuration or query error.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'radar-status.log'
$stamp = [DateTime]::UtcNow.ToString('o')

$output = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'radar-status.ps1') 2>&1
$code = $LASTEXITCODE

"[$stamp] exit=$code" | Out-File -FilePath $log -Append -Encoding utf8
$output | Out-File -FilePath $log -Append -Encoding utf8
'' | Out-File -FilePath $log -Append -Encoding utf8

exit $code
