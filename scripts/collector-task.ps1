param(
 [ValidateSet('market','narratives')][string]$Worker='market',
 [ValidateSet('Install','Start','Stop','Status','Remove','Run')][string]$Action='Status',
 # Register disabled atomically. Triggers remain configured but cannot launch the task.
 [switch]$Disabled
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$taskName="NarraCollector-$Worker"
if($Action -eq 'Run'){
 Set-Location $root
 $logDir=Join-Path $root 'logs'
 New-Item -ItemType Directory -Force $logDir | Out-Null
 $log=Join-Path $logDir "collector-$Worker.log"
 if((Test-Path $log) -and (Get-Item $log).Length -gt 10MB){Move-Item $log "$log.previous" -Force}
 try{
  # Secrets stay in the local environment; task arguments contain only worker and action names.
  . (Join-Path $root 'local-api.ps1')
  $entry=if($Worker -eq 'market'){'workers/pipeline/src/marketMain.ts'}else{'workers/pipeline/src/narrativesMain.ts'}
  "[$([DateTime]::UtcNow.ToString('o'))] Starting scoped $Worker collector" | Out-File $log -Append -Encoding utf8
  # PowerShell 5 treats native stderr as an ErrorRecord: preserve logging without terminating the wrapper early.
  $ErrorActionPreference='Continue'
  & node --require ./apps/web/scripts/no-env-files.cjs --import tsx $entry 2>&1 | Out-File $log -Append -Encoding utf8
 }catch{
  "[$([DateTime]::UtcNow.ToString('o'))] Collector configuration/start failed" | Out-File $log -Append -Encoding utf8
 }
 # A collector is long-lived. Any exit should trigger the scheduler's bounded restart delay.
 exit 1
}
function Stop-CollectorTask {
 Disable-ScheduledTask -TaskName $taskName | Out-Null
 # Task Scheduler may stop only PowerShell, leaving its native Node child alive. Capture ownership before stopping.
 $processes=@(Get-CimInstance Win32_Process)
 $script=Join-Path $PSScriptRoot 'collector-task.ps1'
 $owned=@($processes | Where-Object {
  $_.Name -eq 'powershell.exe' -and $_.CommandLine -and
  $_.CommandLine.IndexOf($script,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and
  $_.CommandLine -match "-Worker\s+$Worker\b" -and $_.CommandLine -match '-Action\s+Run\b'
 })
 $parents=@($owned | ForEach-Object {$_.ProcessId})
 while($parents.Count){
  $children=@($processes | Where-Object {$_.ParentProcessId -in $parents -and $_.ProcessId -notin @($owned | ForEach-Object {$_.ProcessId})})
  $owned+=$children
  $parents=@($children | ForEach-Object {$_.ProcessId})
 }
 Stop-ScheduledTask -TaskName $taskName
 foreach($process in $owned){
  $current=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)"
  # Do not terminate a reused PID or an unrelated manually started collector.
  if($current -and $current.CreationDate -eq $process.CreationDate){
   Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
   Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue | Wait-Process -Timeout 15 -ErrorAction Stop
  }
 }
}
switch($Action){
 'Install' {
  if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw "Task $taskName already exists; inspect it before replacing."}
  $user=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $script=Join-Path $PSScriptRoot 'collector-task.ps1'
  $run=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Worker $Worker -Action Run" -WorkingDirectory $root
  $trigger=@((New-ScheduledTaskTrigger -AtLogOn -User $user),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
  $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
   $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
   if($Disabled){$settings.Enabled=$false}
  Register-ScheduledTask -TaskName $taskName -Action $run -Trigger $trigger -Principal $principal -Settings $settings -Description "Scoped Narrax $Worker collector; restart on exit; no executor or alert delivery." | Select-Object TaskName,State
 }
 'Start' {Enable-ScheduledTask -TaskName $taskName | Out-Null; Start-ScheduledTask -TaskName $taskName}
  'Stop' {Stop-CollectorTask}
  'Remove' {Stop-CollectorTask; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false}
 'Status' {
  Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State | Format-List
  Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime,LastTaskResult,NextRunTime | Format-List
 }
}
