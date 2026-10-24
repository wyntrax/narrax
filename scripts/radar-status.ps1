# Radar liveness for Windows Task Scheduler. Loads the local .env, runs the check, and forwards its exit code.
# Exit 0 = fresh, 2 = stale, 1 = configuration or query error. Read-only.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Get-Content (Join-Path $root '.env') | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    $key = $matches[1]
    $value = $matches[2].Trim()
    if ($value -match '^"(.*)"$') { $value = $matches[1] }
    elseif ($value -match "^'(.*)'$") { $value = $matches[1] }
    Set-Item -Path "Env:$key" -Value $value
  }
}

& npm run radar:status -- --json
exit $LASTEXITCODE
