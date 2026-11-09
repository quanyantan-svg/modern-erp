# One-command launcher for the OUT-001 protected real MySQL 8 gate.
#
# The launcher never asks for a password and never accepts a script:
#
#   - the gate, its ACK-4 Manifest (OUT_001_MYSQL_V1) and its suite file are
#     fixed; there is no parameter that could point the gate at another script;
#   - it reads the DPAPI-encrypted test credential from the current Windows
#     user's LocalAppData and keeps it in the process environment only;
#   - it loads the fixed, non-secret identity baseline and proves the live
#     identity and the empty schema before the gate starts;
#   - it takes a machine-wide named mutex so only one schema-clearing gate can
#     run against the target at a time;
#   - it calls the protected gate and reports PASS / FAIL / BLOCKED together
#     with the ACK-4 terminal state and the cleanup outcome;
#   - it clears the sensitive environment variables from the current process.
#
# A drifted identity is never re-authorized automatically. Re-establish the
# baseline deliberately with setup-mysql-local-gate.ps1 instead.
#
# Usage (from the repository root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-out001-mysql-gate.ps1 `
#     -RunId <uuid> -Ack4Capability <path>
#
# Requirement : document.md §31.14.2
# Design      : docs/design/procurement-outsourcing.md §26.34.15、§26.34.15.3

[CmdletBinding()]
param(
  [string]$RunId,
  [string]$Ack4Capability
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($RunId) -or [string]::IsNullOrWhiteSpace($Ack4Capability)) {
  Write-Host '[out001-mysql-gate] BLOCKED: -RunId and -Ack4Capability are required; the launcher cannot issue approval or invent fixtures.' -ForegroundColor Red
  exit 7
}
if (-not (Test-Path -LiteralPath $Ack4Capability)) {
  Write-Host "[out001-mysql-gate] BLOCKED: the ACK-4 capability file does not exist ($Ack4Capability)." -ForegroundColor Red
  exit 7
}

# Windows PowerShell 5.1 does not load the DPAPI assembly by default. On
# PowerShell 7 the type already lives in the shared framework, so the attempt
# is made without failing the script.
try { Add-Type -AssemblyName System.Security -ErrorAction Stop } catch { }

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$localDir = Join-Path $env:LOCALAPPDATA 'ModernERP\mysql-gate'
$baselinePath = Join-Path $localDir 'target.json'
$credentialPath = Join-Path $localDir 'credential.dat'
$preflightHelper = Join-Path $repoRoot 'scripts\gates\mysql-local-preflight.mjs'
$gateScript = Join-Path $repoRoot 'scripts\gates\mysql-out001-gate.mjs'
$rootEvidenceVerifier = Join-Path $repoRoot 'scripts\gates\mysql-out001-root-evidence.mjs'
$commitSha = (& git -C $repoRoot rev-parse HEAD).Trim()
$manifestName = 'OUT_001_MYSQL_V1'

function Write-LauncherResult([System.Collections.IDictionary]$Result) {
  $rootDir = Join-Path $localDir "evidence\$RunId\root"
  [System.IO.Directory]::CreateDirectory($rootDir) | Out-Null
  $target = Join-Path $rootDir 'launcher-result.json'
  if (Test-Path -LiteralPath $target) { throw 'OUT_001_LAUNCHER_RESULT_OVERWRITE_REFUSED' }
  $temporary = Join-Path $rootDir ('.launcher-result.' + [guid]::NewGuid().ToString() + '.tmp')
  try {
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes(($Result | ConvertTo-Json -Depth 20) + "`n")
    $stream = [System.IO.File]::Open($temporary, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    [System.IO.File]::Move($temporary, $target)
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}

function Write-Step([string]$message) {
  Write-Host "[out001-mysql-gate] $message"
}

function Write-Block([string]$message) {
  Write-Host "[out001-mysql-gate] BLOCKED: $message" -ForegroundColor Red
}

function Clear-GateEnvironment {
  foreach ($name in @(
    'ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD',
    'ERP_DB_BACKEND', 'ERP_TEST_DB_BACKEND', 'ERP_DB_PATH',
    'ERP_MYSQL_TEST_ALLOW_RESET', 'ERP_MYSQL_TEST_DISPOSABLE_TARGET', 'ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS',
    'ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID', 'ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER',
    'ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256', 'ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY',
    'ERP_MYSQL_WAVE10_INITIAL_INVENTORY', 'ERP_MYSQL_WAVE10_CAMPAIGN_ID', 'ERP_MYSQL_WAVE10_CAMPAIGN_LEASE',
    'ERP_OUT_001_TARGET_PROOF', 'MYSQL_LOCAL_BASELINE_PATH'
  )) {
    Remove-Item "Env:\$name" -ErrorAction SilentlyContinue
  }
}

# Windows PowerShell 5.1 flattens Start-Process -ArgumentList to one command
# line. Quote each path/value explicitly so repository and capability paths
# containing spaces remain one native argument.
function ConvertTo-NativeArgument([string]$Argument) {
  if ($Argument -notmatch '[\s"]') { return $Argument }
  $escaped = [regex]::Replace($Argument, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  $quote = [char]34
  return $quote + $escaped + $quote
}

# Runs a native helper and keeps its stdout and its stderr apart. A native
# command that writes to stderr must not be turned into a terminating
# PowerShell error, and the real error text must survive.
function Invoke-NodeHelper {
  param([string]$HelperPath)

  $stdoutFile = [System.IO.Path]::GetTempFileName()
  $stderrFile = [System.IO.Path]::GetTempFileName()
  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $process = Start-Process -FilePath 'node' -ArgumentList (ConvertTo-NativeArgument $HelperPath) -NoNewWindow -Wait -PassThru `
      -WorkingDirectory $repoRoot -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    $ErrorActionPreference = $previousPreference
    $stdoutText = (Get-Content -Raw -Encoding UTF8 $stdoutFile) -replace "`0", ''
    $stderrText = (Get-Content -Raw -Encoding UTF8 $stderrFile) -replace "`0", ''
    return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdoutText; Stderr = $stderrText }
  } finally {
    Remove-Item $stdoutFile, $stderrFile -ErrorAction SilentlyContinue
  }
}

# Every schema-clearing gate runs under one machine-wide lock, so two gates can
# never clean the same schema at the same time. The lock is a named mutex
# because the operating system releases it when the holder dies.
function Enter-GateLock([string]$name) {
  $mutex = $null
  try {
    $createdNew = $false
    $mutex = [System.Threading.Mutex]::new($false, "Global\$name", [ref]$createdNew)
  } catch {
    if ($null -ne $mutex) { $mutex.Dispose() }
    throw [System.InvalidOperationException]::new("GLOBAL_MUTEX_CREATE_FAILED:$name", $_.Exception)
  }
  $acquired = $false
  try {
    $acquired = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $acquired = $true
  } catch {
    $mutex.Dispose()
    throw [System.InvalidOperationException]::new("GLOBAL_MUTEX_ACQUIRE_FAILED:$name", $_.Exception)
  }
  if (-not $acquired) {
    $mutex.Dispose()
    return $null
  }
  return $mutex
}

function Exit-GateLock($mutex) {
  if ($null -eq $mutex) { return }
  try { $mutex.ReleaseMutex() } catch { }
  $mutex.Dispose()
}

$targetProofPath = $null
$gateLock = $null
trap {
  Write-Block "unexpected launcher failure; ACK-4/destructive work is blocked ($($_.Exception.Message))."
  Clear-GateEnvironment
  $password = $null
  if ($targetProofPath) { Remove-Item -LiteralPath $targetProofPath -Force -ErrorAction SilentlyContinue }
  Exit-GateLock $gateLock
  exit 8
}

if (-not (Test-Path $baselinePath)) {
  Write-Block "the local target baseline is missing ($baselinePath). Run scripts/gates/setup-mysql-local-gate.ps1 once first."
  exit 1
}
if (-not (Test-Path $credentialPath)) {
  Write-Block "the local encrypted credential is missing ($credentialPath). Run scripts/gates/setup-mysql-local-gate.ps1 once first."
  exit 1
}

$baseline = Get-Content -Raw -Encoding UTF8 $baselinePath | ConvertFrom-Json
$protected = [System.IO.File]::ReadAllBytes($credentialPath)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
$password = [System.Text.Encoding]::UTF8.GetString($plain)
[System.Array]::Clear($plain, 0, $plain.Length)

# --- Identity and empty-schema preflight ------------------------------------
# The destructive authorization variables are withheld from the read-only
# preflight on purpose: the preflight proves identity, it never authorizes a
# destructive operation.
Clear-GateEnvironment
$env:ERP_DB_HOST = $baseline.host
$env:ERP_DB_PORT = [string]$baseline.port
$env:ERP_DB_NAME = $baseline.database
$env:ERP_DB_USER = $baseline.user
$env:ERP_DB_PASSWORD = $password
$env:ERP_DB_BACKEND = 'mysql'
$env:ERP_TEST_DB_BACKEND = 'mysql'
$env:MYSQL_LOCAL_BASELINE_PATH = $baselinePath

Write-Step "Verifying the target identity and the empty schema ($($baseline.database) as $($baseline.user))..."
$preflightRun = Invoke-NodeHelper -HelperPath $preflightHelper
if ($preflightRun.ExitCode -ne 0) {
  Write-Block 'the target preflight did not pass; the gate was not started.'
  if ($preflightRun.Stderr) { $preflightRun.Stderr.Trim() -split "`r?`n" | ForEach-Object { Write-Host "    $_" } }
  if ($preflightRun.Stdout) { $preflightRun.Stdout.Trim() -split "`r?`n" | ForEach-Object { Write-Host "    $_" } }
  Clear-GateEnvironment
  $password = $null
  exit 2
}
$preflight = ($preflightRun.Stdout -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 1) | ConvertFrom-Json
Write-Step "  target       : $($preflight.identity.database) as $($preflight.identity.currentUser)"
Write-Step "  server       : $($preflight.identity.serverVersion)  uuid=$($preflight.identity.serverUuid)"
Write-Step "  grants sha256: $($preflight.identity.grantsSha256)"
Write-Step "  objects      : tables=$($preflight.inventory.tables) views=$($preflight.inventory.views) triggers=$($preflight.inventory.triggers) routines=$($preflight.inventory.routines) events=$($preflight.inventory.events)"
$targetProofPath = [System.IO.Path]::GetTempFileName()
$targetProof = [ordered]@{
  host = [string]$baseline.host; port = [int]$baseline.port; database = [string]$baseline.database; user = [string]$baseline.user
  selectedDatabase = [string]$preflight.identity.database; currentUser = [string]$preflight.identity.currentUser
  serverUuid = [string]$preflight.identity.serverUuid; grantsSha256 = [string]$preflight.identity.grantsSha256
}
[System.IO.File]::WriteAllText(
  $targetProofPath,
  ($targetProof | ConvertTo-Json -Compress),
  (New-Object System.Text.UTF8Encoding($false))
)

# --- Serialization ------------------------------------------------------------
$lockName = "ModernERP.MySqlGate.$($baseline.database)"
try {
  $gateLock = Enter-GateLock $lockName
} catch {
  Write-Block "the machine-wide Global Mutex could not be created or acquired for this target ($lockName)."
  Clear-GateEnvironment
  $password = $null
  Remove-Item -LiteralPath $targetProofPath -Force -ErrorAction SilentlyContinue
  exit 6
}
if ($null -eq $gateLock) {
  Write-Block "another schema-clearing MySQL gate already holds the lock for this target ($lockName)."
  Clear-GateEnvironment
  $password = $null
  Remove-Item -LiteralPath $targetProofPath -Force -ErrorAction SilentlyContinue
  exit 6
}

# --- The protected gate ------------------------------------------------------
# The gate is fixed: OUT_001_MYSQL_V1 with the suite
# server/mysql-out001.integration.js. There is no script parameter.
$env:ERP_MYSQL_TEST_ALLOW_RESET = 'true'
$env:ERP_MYSQL_TEST_DISPOSABLE_TARGET = $baseline.disposableTarget
$env:ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS = 'DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP'
$env:ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID = $baseline.serverUuid
$env:ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER = $baseline.currentUser
$env:ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256 = $baseline.grantsSha256
$env:ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY = 'MYSQL_8'
$env:ERP_MYSQL_WAVE10_INITIAL_INVENTORY = 'EMPTY_ONLY'
$env:ERP_OUT_001_TARGET_PROOF = $targetProofPath

Write-Step ''
Write-Step 'Running the OUT-001 protected MySQL gate (Manifest OUT_001_MYSQL_V1)...'
$gateOutFile = [System.IO.Path]::GetTempFileName()
$gateErrFile = [System.IO.Path]::GetTempFileName()
Push-Location $repoRoot
try {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $gateArguments = @(
    (ConvertTo-NativeArgument $gateScript), '--run-id', (ConvertTo-NativeArgument $RunId),
    '--ack4-capability', (ConvertTo-NativeArgument ([System.IO.Path]::GetFullPath($Ack4Capability))),
    '--target-proof', (ConvertTo-NativeArgument $targetProofPath)
  )
  $gate = Start-Process -FilePath 'node' -ArgumentList $gateArguments `
    -NoNewWindow -Wait -PassThru -WorkingDirectory $repoRoot -RedirectStandardOutput $gateOutFile -RedirectStandardError $gateErrFile
  $gateExit = $gate.ExitCode
  $ErrorActionPreference = $previousPreference
} finally {
  Pop-Location
}
$gateStdout = (Get-Content -Raw -Encoding UTF8 $gateOutFile) -replace "`0", ''
$gateStderr = (Get-Content -Raw -Encoding UTF8 $gateErrFile) -replace "`0", ''

# --- Root ACK-4 state -------------------------------------------------------
Remove-Item Env:\ERP_MYSQL_TEST_ALLOW_RESET -ErrorAction SilentlyContinue
Remove-Item Env:\ERP_MYSQL_TEST_DISPOSABLE_TARGET -ErrorAction SilentlyContinue
Remove-Item Env:\ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS -ErrorAction SilentlyContinue

$rootState = 'BLOCKED'
$rootReport = $null
$rootEvidenceValid = $false
try {
  $verifyOut = & node $rootEvidenceVerifier --run-id $RunId --commit-sha $commitSha --manifest $manifestName 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($verifyOut -join "`n") }
  try {
    $verified = ($verifyOut -join "`n") | ConvertFrom-Json
    if ($verified.valid -ne $true) { throw 'root verifier did not return valid=true' }
    $rootReport = $verified.report
    if ($rootReport.state) { $rootState = [string]$rootReport.state }
    $rootEvidenceValid = $true
  } catch { throw "root evidence JSON invalid: $($_.Exception.Message)" }
} catch {
  $rootState = 'BLOCKED'
  $rootEvidenceDiagnostic = $_.Exception.Message
}

$launcherResult = [ordered]@{
  version = 1; runId = $RunId; commitSha = $commitSha; manifest = $manifestName
  gateExitCode = $gateExit; rootEvidenceValid = $rootEvidenceValid; rootState = $rootState
  result = if ($gateExit -eq 0 -and $rootEvidenceValid -and $rootState -eq 'FINISHED' -and
    $rootReport.testsPassed -eq $true -and $rootReport.cleanupProven -eq $true -and $rootReport.childrenExited -eq $true) { 'PASS' }
    elseif ($rootState -eq 'BLOCKED') { 'BLOCKED' } else { 'FAIL' }
  diagnostic = if ($rootEvidenceValid) { $null } else { $rootEvidenceDiagnostic }
  gateStdoutBytes = (Get-Item -LiteralPath $gateOutFile).Length
  gateStderrBytes = (Get-Item -LiteralPath $gateErrFile).Length
  gateStdoutSha256 = (Get-FileHash -LiteralPath $gateOutFile -Algorithm SHA256).Hash.ToLowerInvariant()
  gateStderrSha256 = (Get-FileHash -LiteralPath $gateErrFile -Algorithm SHA256).Hash.ToLowerInvariant()
  createdAt = [DateTime]::UtcNow.ToString('o')
}
try { Write-LauncherResult $launcherResult } catch {
  $rootEvidenceValid = $false; $rootState = 'BLOCKED'; $rootEvidenceDiagnostic = $_.Exception.Message
}
Remove-Item $gateOutFile, $gateErrFile -ErrorAction SilentlyContinue

Clear-GateEnvironment
$password = $null
Remove-Item -LiteralPath $targetProofPath -Force -ErrorAction SilentlyContinue
Exit-GateLock $gateLock
$gateLock = $null

# The evidence is persisted by the gate itself; the launcher only reports the
# paths so that a failed run can be reviewed without re-running anything.
Write-Step ''
Write-Step 'Gate evidence (stdout / stderr / result per child):'
if ($null -ne $rootReport -and $null -ne $rootReport.evidence) {
  foreach ($item in $rootReport.evidence) {
    $tapSummary = 'n/a'
    if ($null -ne $item.tap) {
      $tapSummary = "tests=$($item.tap.tests) pass=$($item.tap.passed) fail=$($item.tap.failed) skipped=$($item.tap.skipped) cancelled=$($item.tap.cancelled)"
    }
    Write-Host ("  [{0}] exit={1} tapParsed={2} {3}" -f $item.suite, $item.exitCode, $item.tapParsed, $tapSummary)
    Write-Host ("      stdout : {0} ({1} bytes, sha256 {2})" -f $item.stdoutPath, $item.stdoutBytes, $item.stdoutSha256)
    Write-Host ("      stderr : {0} ({1} bytes, sha256 {2})" -f $item.stderrPath, $item.stderrBytes, $item.stderrSha256)
    Write-Host ("      result : {0}" -f $item.resultPath)
  }
} else {
  Write-Host '  (no evidence was produced)'
}

Write-Step ''
if ($gateExit -eq 0 -and $rootEvidenceValid -and $rootState -eq 'FINISHED' -and $null -ne $rootReport -and
    $rootReport.testsPassed -eq $true -and $rootReport.cleanupProven -eq $true -and $rootReport.childrenExited -eq $true) {
  Write-Host '[out001-mysql-gate] RESULT = PASS' -ForegroundColor Green
  Write-Host '[out001-mysql-gate] ACK-4 STATE = FINISHED (cleanup independently post-flighted by the root)'
  exit 0
}
if (-not $rootEvidenceValid) {
  Write-Host '[out001-mysql-gate] RESULT = BLOCKED' -ForegroundColor Red
  Write-Host "[out001-mysql-gate] ROOT EVIDENCE = INVALID ($rootEvidenceDiagnostic)"
  exit 8
}
if ($rootState -eq 'FAILED') {
  Write-Host '[out001-mysql-gate] RESULT = FAIL' -ForegroundColor Red
  Write-Host '[out001-mysql-gate] ACK-4 STATE = FAILED (tests failed; cleanup was proven)'
  if ($gateStderr) { $gateStderr.Trim() -split "`r?`n" | Select-Object -Last 40 | ForEach-Object { Write-Host "    $_" } }
  exit 5
}
if ($rootState -eq 'CLEANUP_UNVERIFIED') {
  Write-Host '[out001-mysql-gate] RESULT = FAIL' -ForegroundColor Red
  Write-Host '[out001-mysql-gate] ACK-4 STATE = CLEANUP_UNVERIFIED (target quarantined; recovery approval required)'
  if ($gateStderr) { $gateStderr.Trim() -split "`r?`n" | Select-Object -Last 40 | ForEach-Object { Write-Host "    $_" } }
  if ($gateExit -eq 0) { exit 8 }
  exit $gateExit
}
if ($gateStderr) { $gateStderr.Trim() -split "`r?`n" | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" } }
Write-Host '[out001-mysql-gate] RESULT = FAIL' -ForegroundColor Red
Write-Host "[out001-mysql-gate] ACK-4 STATE = $rootState (gate exit $gateExit)"
if ($gateExit -eq 0) { exit 8 }
exit $gateExit
