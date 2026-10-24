# ============================================================
# dsh-version-badge-own - background auto-update runner
# ------------------------------------------------------------
# Trigger: user double-clicks auto-update.cmd
# Then fully automatic: plan -> stop host -> apply -> relaunch host
#
# Design notes
#  1. Must run as its own process (cmd uses start /b), NOT as a
#     child of the DSH host, otherwise killing the host kills it.
#  2. All output text is ASCII-only so Windows PowerShell 5.1 can
#     parse this file regardless of BOM / ANSI decoding.
#  3. Stop on failure, keep the scene, do not roll forward.
#  4. Log: D:\DSH\_tmp\update-runner\auto-update.log
# ============================================================

param(
  [switch]$OnlyUpdate,
  [switch]$SkipRestart,
  [string]$ReportFile = 'D:\DSH\_tmp\update-runner\auto-update-report.json'
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

# ---------- paths ----------
$WORK     = 'D:\DSH\_tmp\update-runner'
$LOG      = Join-Path $WORK 'auto-update.log'
$PLAN     = Join-Path $WORK 'plan.json'
$STATE    = Join-Path $WORK 'state.json'
$RUNNER   = 'D:\DSH\plugins\dsh-version-badge-own\scripts\update-runner.mjs'
$NODE     = 'D:\ccd\node.exe'
$EXE      = 'C:\Users\L1772\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe'
$EXE_DIR  = 'C:\Users\L1772\AppData\Local\Programs\DeepSeek Harness'

New-Item -ItemType Directory -Path $WORK -Force | Out-Null

# ---------- logging ----------
function Log {
  param([string]$Phase, [string]$Msg, $Extra)
  $line = '{0} | {1} | {2}' -f (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fff'), $Phase, $Msg
  if ($Extra) { $line += ' | ' + ($Extra | ConvertTo-Json -Compress -Depth 4) }
  Add-Content -Path $LOG -Value $line -Encoding UTF8
  Write-Host $line
}

$report = [ordered]@{
  startedAt    = (Get-Date).ToString('o')
  finishedAt   = $null
  runnerPid    = $PID
  phases       = @()
  pluginResult = $null
  hostRestart  = $null
  errors       = @()
}

function AddPhase {
  param([string]$Name, [string]$Status, $Detail)
  $script:report.phases += [ordered]@{ name = $Name; status = $Status; detail = $Detail; at = (Get-Date).ToString('o') }
}

function SaveReport {
  try { $script:report | ConvertTo-Json -Depth 8 | Set-Content $ReportFile -Encoding UTF8 } catch {}
}

function Fail {
  param([string]$Msg, $Extra)
  Log 'FATAL' $Msg $Extra
  $script:report.finishedAt = (Get-Date).ToString('o')
  $script:report.errors += $Msg
  SaveReport
  exit 1
}

Log 'start' 'auto-update begin' @{ pid = $PID; only = [bool]$OnlyUpdate; skipRestart = [bool]$SkipRestart }

# ---------- 0) precheck ----------
if (-not (Test-Path $RUNNER)) { Fail "runner missing: $RUNNER" }
if (-not (Test-Path $EXE))    { Fail "host exe missing: $EXE" }

$nodeExe = $NODE
if (-not (Test-Path $nodeExe)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $nodeExe = $cmd.Source } else { Fail 'node not found' }
}
Log 'precheck' 'paths ok' @{ node = $nodeExe }
AddPhase 'precheck' 'ok' @{ node = $nodeExe }

# ---------- 1) plan ----------
Log 'plan' 'scanning updates'
$planOut = & $nodeExe $RUNNER --plan 2>&1 | Out-String
Add-Content -Path $LOG -Value $planOut -Encoding UTF8
$planCode = $LASTEXITCODE
if ($planCode -ne 0) { Fail 'plan failed' @{ code = $planCode } }

$planObj = $null
try { $planObj = Get-Content $PLAN -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Fail 'cannot parse plan.json' }
$items = @($planObj.items)
$itemNames = @()
foreach ($it in $items) { $itemNames += ("{0} {1}->{2} [{3}]" -f $it.name, $it.current, $it.latest, $it.action) }
Log 'plan' ("found " + $items.Count + " updatable plugins") @{ items = $itemNames }
AddPhase 'plan' 'ok' @{ count = $items.Count; items = $itemNames }

if ($items.Count -eq 0) {
  Log 'plan' 'no updates, exiting'
  $script:report.finishedAt = (Get-Date).ToString('o')
  SaveReport
  Log 'done' 'auto-update complete (nothing to do)'
  exit 0
}

# ---------- 2) stop host ----------
if (-not $OnlyUpdate) {
  $hostProcs = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
  if ($hostProcs.Count -gt 0) {
    $pids = @()
    foreach ($hp in $hostProcs) { $pids += $hp.Id }
    Log 'stop' ("stopping " + $hostProcs.Count + " host processes") @{ pids = $pids }
    try { $hostProcs | Stop-Process -Force -ErrorAction Stop } catch { Log 'stop' 'Stop-Process error, continue' @{ err = $_.Exception.Message } }

    $deadline = (Get-Date).AddSeconds(25)
    while ((Get-Date) -lt $deadline) {
      if (@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -eq 0) { break }
      Start-Sleep -Milliseconds 500
    }
    if (@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -gt 0) {
      Log 'stop' 'still alive, taskkill /T'
      & taskkill /F /IM 'DeepSeek Harness.exe' /T 2>&1 | Out-Null
      Start-Sleep -Seconds 3
    }
    Start-Sleep -Seconds 2
    $left = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count
    Log 'stop' ("host stopped, remaining " + $left)
    $stopStatus = 'ok'
    if ($left -ne 0) { $stopStatus = 'warn' }
    AddPhase 'stop-host' $stopStatus @{ remaining = $left }
  } else {
    Log 'stop' 'host not running, skip'
    AddPhase 'stop-host' 'skipped' 'host not running'
  }
} else {
  AddPhase 'stop-host' 'skipped' 'OnlyUpdate'
}

# ---------- 3) apply ----------
Log 'apply' 'updating plugins'
$applyOut  = & $nodeExe $RUNNER --apply 2>&1 | Out-String
$applyCode = $LASTEXITCODE
Add-Content -Path $LOG -Value $applyOut -Encoding UTF8
Log 'apply' ("apply done, exit=" + $applyCode)

$stateObj = $null
try { $stateObj = Get-Content $STATE -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
if ($stateObj) {
  $script:report.pluginResult = $stateObj.results
  $okCount = 0; $badCount = 0; $skipCount = 0
  foreach ($r in $stateObj.results) {
    if ($r.status -eq 'ok') { $okCount++ }
    elseif ($r.status -eq 'failed' -or $r.status -eq 'blocked') { $badCount++ }
    elseif ($r.status -like 'skipped*') { $skipCount++ }
  }
  Log 'apply' ("ok=$okCount bad=$badCount skipped=$skipCount")
  $applyStatus = 'error'
  if ($applyCode -eq 0) { $applyStatus = 'ok' } elseif ($applyCode -eq 2) { $applyStatus = 'partial' }
  AddPhase 'apply' $applyStatus @{ exitCode = $applyCode; ok = $okCount; bad = $badCount; skipped = $skipCount }
} else {
  Log 'apply' 'state.json unreadable' @{ code = $applyCode }
  AddPhase 'apply' 'error' @{ exitCode = $applyCode }
}

# ---------- 4) relaunch host ----------
if (-not $OnlyUpdate -and -not $SkipRestart) {
  Log 'restart' 'launching host'
  $launched = $false
  try {
    Start-Process -FilePath $EXE -WorkingDirectory $EXE_DIR -WindowStyle Normal
    $launched = $true
    Log 'restart' 'launch command sent'
  } catch {
    Log 'restart' 'launch failed' @{ err = $_.Exception.Message }
    $script:report.errors += ("launch host failed: " + $_.Exception.Message)
  }

  if ($launched) {
    $deadline = (Get-Date).AddSeconds(90)
    $port = $null
    $hostPid = $null
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 2
      $procs = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
      if ($procs.Count -gt 0) {
        $pids = @()
        foreach ($pp in $procs) { $pids += $pp.Id }
        $conns = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)
        foreach ($c in $conns) {
          if ($pids -contains $c.OwningProcess) {
            if ($c.LocalAddress -eq '127.0.0.1' -or $c.LocalAddress -eq '0.0.0.0') {
              $port = $c.LocalPort; $hostPid = $c.OwningProcess; break
            }
          }
        }
        if ($port) { break }
      }
    }
    if ($port) {
      Log 'restart' ("host up, port " + $port) @{ pid = $hostPid }
      $script:report.hostRestart = [ordered]@{ ok = $true; port = $port; pid = $hostPid }
      AddPhase 'restart' 'ok' @{ port = $port; pid = $hostPid }
    } else {
      Log 'restart' 'timeout waiting for port'
      $script:report.hostRestart = [ordered]@{ ok = $false; reason = 'no listening port in 90s' }
      AddPhase 'restart' 'timeout' 'no listening port in 90s'
      $script:report.errors += 'no listening port within 90s after launch'
    }
  }
} else {
  Log 'restart' 'skipped by flag'
  AddPhase 'restart' 'skipped' $null
}

# ---------- 5) report ----------
$script:report.finishedAt = (Get-Date).ToString('o')
SaveReport
Log 'done' 'auto-update complete' @{ report = $ReportFile }

Write-Host ''
Write-Host '=========== RESULT ==========='
if ($script:report.pluginResult) {
  foreach ($r in $script:report.pluginResult) {
    Write-Host ("  {0}  {1} -> {2}  {3}" -f $r.name, $r.from, $r.to, $r.status)
  }
}
if ($script:report.hostRestart) {
  $hs = 'not confirmed'
  if ($script:report.hostRestart.ok) { $hs = 'up, port ' + $script:report.hostRestart.port }
  Write-Host ("  host: " + $hs)
}
Write-Host ("  report: " + $ReportFile)
Write-Host ("  log:    " + $LOG)
exit 0