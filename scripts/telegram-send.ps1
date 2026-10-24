# Early Radar Telegram delivery. Loads the local .env, then runs the CLI.
# Default is a dry run. Use -Send only after the messages and the test chat have been checked.
param(
  [switch]$Send,
  [switch]$Json,
  [int]$Limit = 0,
  [int]$MaxAgeMin = 0,
  [string]$ChatId = ''
)

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

$npmArgs = @('run', 'telegram:send', '--')
if ($Send) { $npmArgs += '--send' }
if ($Json) { $npmArgs += '--json' }
if ($Limit -gt 0) { $npmArgs += @('--limit', "$Limit") }
if ($MaxAgeMin -gt 0) { $npmArgs += @('--max-age-min', "$MaxAgeMin") }
if ($ChatId) { $npmArgs += @('--chat-id', $ChatId) }

& npm @npmArgs
exit $LASTEXITCODE
