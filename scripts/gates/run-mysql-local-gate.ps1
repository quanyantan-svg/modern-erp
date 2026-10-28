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
  [string]$Script = 'test:mysql:wave11-sec'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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
Push-Location $repoRoot
try {
  # A native command that writes to stderr must not be turned into a
  # terminating PowerShell error, so the preference is relaxed for the call
  # and restored immediately afterwards.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $pnpm run $Script
  $gateExit = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
} finally {
  Pop-Location
}

# --- Cleanup verification ----------------------------------------------------
# The five object categories are counted again on a fresh session, so the
# cleanup conclusion does not depend on the gate's own report.
Remove-Item Env:\ERP_MYSQL_TEST_ALLOW_RESET -ErrorAction SilentlyContinue
Remove-Item Env:\ERP_MYSQL_TEST_DISPOSABLE_TARGET -ErrorAction SilentlyContinue
Remove-Item Env:\ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS -ErrorAction SilentlyContinue

$postflightRun = Invoke-NodeHelper -HelperPath $preflightHelper
$cleanupConfirmed = $false
$cleanupDetail = 'not confirmed'
if ($postflightRun.ExitCode -eq 0) {
  $postflight = ($postflightRun.Stdout -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 1) | ConvertFrom-Json
  $cleanupConfirmed = $true
  $cleanupDetail = "tables=$($postflight.inventory.tables) views=$($postflight.inventory.views) triggers=$($postflight.inventory.triggers) routines=$($postflight.inventory.routines) events=$($postflight.inventory.events)"
} else {
  $cleanupDetail = "the post-run inventory could not be read: $($postflightRun.Stderr.Trim() -split "`r?`n" | Select-Object -First 1)"
}

Clear-GateEnvironment
$password = $null
if ($null -ne $gateLock) { $gateLock.Dispose() }

Write-Step ''
if ($gateExit -eq 0 -and $cleanupConfirmed) {
  Write-Host "[mysql-gate] RESULT = PASS" -ForegroundColor Green
  Write-Host "[mysql-gate] CLEANUP = CONFIRMED ($cleanupDetail)"
  Write-Host "[mysql-gate] The target schema is empty and the test account is kept for the next run."
  exit 0
}
if ($gateExit -eq 0 -and -not $cleanupConfirmed) {
  Write-Host "[mysql-gate] RESULT = FAIL" -ForegroundColor Red
  Write-Host "[mysql-gate] CLEANUP = FAILED ($cleanupDetail)"
  Write-Host "[mysql-gate] The gate reported a pass but the cleanup could not be confirmed."
  exit 5
}
Write-Host "[mysql-gate] RESULT = FAIL" -ForegroundColor Red
Write-Host "[mysql-gate] CLEANUP = $cleanupDetail"
Write-Host "[mysql-gate] The gate exited with code $gateExit."
exit $gateExit
