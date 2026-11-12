# One-command launcher for the real MySQL gates.
#
# The launcher makes the unified local MySQL test target reproducible for
# anyone who can run the repository. It never asks for a password:
#
#   - it reads the DPAPI-encrypted test credential from the current Windows
#     user's LocalAppData;
#   - it loads the fixed, non-secret identity baseline;
#   - it proves the live identity and the empty schema before it starts, and
#     it refuses to continue when the identity drifted;
#   - it takes a machine-wide lock so that only one schema-clearing gate can
#     run against the target at a time;
#   - it calls the requested protected gate;
#   - it reports PASS / FAIL / BLOCKED together with the cleanup outcome;
#   - it clears the sensitive environment variables from the current process.
#
# A drifted identity is never re-authorized automatically. Re-establish the
# baseline deliberately with the setup script instead.
#
# Usage (from the repository root):
#   pnpm test:mysql:local
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 -Script test:mysql:wave11-sec
#
# Requirement : document.md §4.1 `W11-SEC-01`, §8 A-D2-*
# Design      : solution.md §37.54.7.11, §37.54.14.4, §37.54.15.2

[CmdletBinding()]
param(
  [string]$Script = 'test:mysql:m1-core',
  [string]$RunId,
  [string]$Ack4Capability,
  [int]$AppPortA = 33101,
  [int]$AppPortB = 33102
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Only campaigns with an independently approved ACK-4 manifest may run here.
# Each entry names the manifest string the issued capability must carry; a
# capability issued for another campaign is rejected by the ACK-4 validator.
$ApprovedCampaigns = @{
  'test:mysql:m1-core'             = 'M1_CORE_G07_V1'
  'test:mysql:accounting-analytics' = 'ACCOUNTING_ANALYTICS_MYSQL_V1'
  'test:mysql:finance'               = 'FINANCE_MYSQL_V1'
  'test:mysql:master-engineering'    = 'MASTER_ENGINEERING_MYSQL_V1'
  'test:mysql:manufacturing-quality' = 'MANUFACTURING_QUALITY_MYSQL_V1'
  'test:mysql:inventory-warehouse'  = 'INVENTORY_WAREHOUSE_MYSQL_V1'
}
if (-not $ApprovedCampaigns.ContainsKey($Script)) {
  Write-Host "[mysql-gate] BLOCKED: $Script has no independently approved ACK-4 manifest." -ForegroundColor Red
  exit 7
}
if ([string]::IsNullOrWhiteSpace($RunId) -or [string]::IsNullOrWhiteSpace($Ack4Capability)) {
  Write-Host '[mysql-gate] BLOCKED: -RunId and -Ack4Capability are required; the launcher cannot issue approval or invent fixtures.' -ForegroundColor Red
  exit 7
}
if ($AppPortA -lt 1024 -or $AppPortA -gt 65535 -or $AppPortB -lt 1024 -or $AppPortB -gt 65535 -or $AppPortA -eq $AppPortB) {
  Write-Host '[mysql-gate] BLOCKED: M1 application ports must be distinct values in 1024..65535.' -ForegroundColor Red
  exit 7
}

# Windows PowerShell 5.1 does not load the DPAPI assembly by default. On
# PowerShell 7 the type already lives in the shared framework and the load is
# a no-op, so the attempt is made without failing the script.
try { Add-Type -AssemblyName System.Security -ErrorAction Stop } catch { }

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$localDir = Join-Path $env:LOCALAPPDATA 'ModernERP\mysql-gate'
$baselinePath = Join-Path $localDir 'target.json'
$credentialPath = Join-Path $localDir 'credential.dat'
$preflightHelper = Join-Path $repoRoot 'scripts\gates\mysql-local-preflight.mjs'

function Write-Step([string]$message) {
  Write-Host "[mysql-gate] $message"
}

function Write-Block([string]$message) {
  Write-Host "[mysql-gate] BLOCKED: $message" -ForegroundColor Red
}

function Clear-GateEnvironment {
  foreach ($name in @(
    'ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD',
    'ERP_DB_BACKEND', 'ERP_TEST_DB_BACKEND', 'ERP_DB_PATH',
    'ERP_MYSQL_TEST_ALLOW_RESET', 'ERP_MYSQL_TEST_DISPOSABLE_TARGET', 'ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS',
    'ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID', 'ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER',
    'ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256', 'ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY',
    'ERP_MYSQL_WAVE10_INITIAL_INVENTORY', 'ERP_MYSQL_WAVE10_CAMPAIGN_ID', 'ERP_MYSQL_WAVE10_CAMPAIGN_LEASE',
    'MYSQL_LOCAL_BASELINE_PATH'
  )) {
    Remove-Item "Env:\$name" -ErrorAction SilentlyContinue
  }
}

function Resolve-Pnpm {
  $command = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($null -ne $command) { return $command.Source }
  $command = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($null -ne $command) { return $command.Source }
  return $null
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
    $process = Start-Process -FilePath 'node' -ArgumentList $HelperPath -NoNewWindow -Wait -PassThru `
      -WorkingDirectory $repoRoot -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    $ErrorActionPreference = $previousPreference
    $stdoutText = (Get-Content -Raw -Encoding UTF8 $stdoutFile) -replace "`0", ''
    $stderrText = (Get-Content -Raw -Encoding UTF8 $stderrFile) -replace "`0", ''
    return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdoutText; Stderr = $stderrText }
  } finally {
    Remove-Item $stdoutFile, $stderrFile -ErrorAction SilentlyContinue
  }
}

# A failing G07 child emits a bounded, sanitized marker block containing all
# parsed TAP failures and the path to the full local restricted evidence file.
# Prefer that block over a tail slice so multiple assertions cannot be lost.
function Write-RootFailureDiagnostics([string]$stderrText, [int]$fallbackLines) {
  if ([string]::IsNullOrWhiteSpace($stderrText)) { return }
  $capturing = $false
  $summary = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($stderrText -split "`r?`n")) {
    $trimmed = $line.Trim()
    if ($trimmed -eq 'M1_G07_DIAGNOSTIC_SUMMARY_BEGIN') { $capturing = $true }
    if ($capturing) { $summary.Add($trimmed) }
    if ($capturing -and $trimmed -eq 'M1_G07_DIAGNOSTIC_SUMMARY_END') { break }
  }
  if ($summary.Count -gt 0) {
    Write-Host '[mysql-gate] ROOT FAILURE SUMMARY:'
    $summary | ForEach-Object { Write-Host "    $_" }
    return
  }
  Write-Host '[mysql-gate] ROOT FAILURE DETAILS:'
  $stderrText.Trim() -split "`r?`n" | Select-Object -Last $fallbackLines | ForEach-Object { Write-Host "    $_" }
}

# Every schema-clearing gate runs under one machine-wide lock, so two gates
# can never clean the same schema at the same time. The lock is a named mutex
# because the operating system releases it when the holder dies.
function Enter-GateLock([string]$name) {
  $mutex = $null
  try {
    $createdNew = $false
    $mutex = [System.Threading.Mutex]::new($false, "Global\$name", [ref]$createdNew)
  } catch [System.UnauthorizedAccessException] {
    $mutex = [System.Threading.Mutex]::new($false, $name)
  }
  $acquired = $false
  try {
    $acquired = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    # The previous holder died without releasing the lock. The mutex is now
    # owned by this process, which is exactly the outcome that is needed.
    $acquired = $true
  }
  if (-not $acquired) {
    $mutex.Dispose()
    return $null
  }
  return $mutex
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

$pnpm = Resolve-Pnpm
if ($null -eq $pnpm) {
  Write-Block 'pnpm is not available on PATH.'
  exit 1
}

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
$gateLock = Enter-GateLock $lockName
if ($null -eq $gateLock) {
  Write-Block "another schema-clearing MySQL gate already holds the lock for this target ($lockName)."
  Clear-GateEnvironment
  $password = $null
  exit 6
}

# --- The protected gate ------------------------------------------------------
# Every gate variable is bound to the same dedicated target. The EXPECTED
# values are the fixed baseline; they are compared against the live identity,
# never replaced by it.
$env:ERP_MYSQL_TEST_ALLOW_RESET = 'true'
$env:ERP_MYSQL_TEST_DISPOSABLE_TARGET = $baseline.disposableTarget
$env:ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS = 'DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP'
$env:ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID = $baseline.serverUuid
$env:ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER = $baseline.currentUser
$env:ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256 = $baseline.grantsSha256
$env:ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY = 'MYSQL_8'
$env:ERP_MYSQL_WAVE10_INITIAL_INVENTORY = 'EMPTY_ONLY'

Write-Step ''
Write-Step "Running pnpm $Script ..."
$gateOutFile = [System.IO.Path]::GetTempFileName()
$gateErrFile = [System.IO.Path]::GetTempFileName()
Push-Location $repoRoot
try {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $gate = Start-Process -FilePath $pnpm -ArgumentList @('run', $Script, '--', '--run-id', $RunId, '--ack4-capability', $Ack4Capability, '--target-proof', $targetProofPath, '--app-port-a', $AppPortA, '--app-port-b', $AppPortB) `
    -NoNewWindow -Wait -PassThru -WorkingDirectory $repoRoot -RedirectStandardOutput $gateOutFile -RedirectStandardError $gateErrFile
  $gateExit = $gate.ExitCode
  $ErrorActionPreference = $previousPreference
} finally {
  Pop-Location
}
$gateStdout = (Get-Content -Raw -Encoding UTF8 $gateOutFile) -replace "`0", ''
$gateStderr = (Get-Content -Raw -Encoding UTF8 $gateErrFile) -replace "`0", ''
Remove-Item $gateOutFile, $gateErrFile -ErrorAction SilentlyContinue

# --- Root ACK-4 state -------------------------------------------------------
# The root now runs its own independent read-only postflight, so the launcher
# must report the root's terminal ACK-4 state instead of re-deriving cleanup
# from a separate preflight. A launcher FAIL while the root marked FINISHED is
# therefore impossible.
Remove-Item Env:\ERP_MYSQL_TEST_ALLOW_RESET -ErrorAction SilentlyContinue
Remove-Item Env:\ERP_MYSQL_TEST_DISPOSABLE_TARGET -ErrorAction SilentlyContinue
Remove-Item Env:\ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS -ErrorAction SilentlyContinue

$rootState = 'UNKNOWN'
$rootReport = $null
$lastJson = $gateStdout -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1
if ($lastJson) {
  try {
    $rootReport = $lastJson | ConvertFrom-Json
    if ($rootReport.state) { $rootState = [string]$rootReport.state }
  } catch { }
}

Clear-GateEnvironment
$password = $null
Remove-Item -LiteralPath $targetProofPath -Force -ErrorAction SilentlyContinue
if ($null -ne $gateLock) { $gateLock.Dispose() }

Write-Step ''
if ($gateExit -eq 0 -and $rootState -eq 'FINISHED' -and $null -ne $rootReport -and
    $rootReport.testsPassed -eq $true -and $rootReport.cleanupProven -eq $true -and $rootReport.childrenExited -eq $true) {
  Write-Host "[mysql-gate] RESULT = PASS" -ForegroundColor Green
  Write-Host "[mysql-gate] ACK-4 STATE = FINISHED (cleanup independently post-flighted by the root)"
  exit 0
}
if ($rootState -eq 'FAILED') {
  Write-Host "[mysql-gate] RESULT = FAIL" -ForegroundColor Red
  Write-Host "[mysql-gate] ACK-4 STATE = FAILED (tests failed; cleanup was proven)"
  Write-RootFailureDiagnostics $gateStderr 40
  exit 5
}
if ($rootState -eq 'CLEANUP_UNVERIFIED') {
  Write-Host "[mysql-gate] RESULT = FAIL" -ForegroundColor Red
  Write-Host "[mysql-gate] ACK-4 STATE = CLEANUP_UNVERIFIED (target quarantined; recovery approval required)"
  Write-RootFailureDiagnostics $gateStderr 40
  if ($gateExit -eq 0) { exit 8 }
  exit $gateExit
}
Write-RootFailureDiagnostics $gateStderr 10
Write-Host "[mysql-gate] RESULT = FAIL" -ForegroundColor Red
Write-Host "[mysql-gate] ACK-4 STATE = $rootState (gate exit $gateExit)"
if ($gateExit -eq 0) { exit 8 }
exit $gateExit
