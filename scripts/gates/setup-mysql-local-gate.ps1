# One-time local setup of the unified MySQL test target.
#
# This script asks for the test account password in a masked local prompt and
# then does everything else by itself:
#
#   - it proves the account against the repository's own least-privilege
#     contract (the eleven target-schema privileges, the three Performance
#     Schema reads, global USAGE only, no roles, no grant delegation);
#   - it proves the target schema is empty;
#   - it stores the test account password as a DPAPI-encrypted blob under the
#     current Windows user's LocalAppData;
#   - it writes the fixed, non-secret identity baseline next to it.
#
# The password is used inside this process only. It is never written to the
# repository, never written to a log, never passed on a command line and never
# echoed. A rejected password is re-prompted in the same window; nothing is
# written until a password is accepted.
#
# The identity baseline is NOT refreshed silently. When a baseline already
# exists and the live identity no longer matches it, the script reports the
# drift and stops. Re-establishing the baseline is a deliberate act and needs
# -ForceBaseline.
#
# Usage (from the repository root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/setup-mysql-local-gate.ps1
#
# Requirement : document.md §4.1 `W11-SEC-01`, §8 A-D2-*
# Design      : solution.md §37.54.7.11, §37.54.14.4, §37.54.15.2

[CmdletBinding()]
param(
  [int]$MaxAttempts = 3,
  [switch]$ForceBaseline
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
$baselineHelper = Join-Path $repoRoot 'scripts\gates\mysql-local-baseline.mjs'

function Write-Step([string]$message) {
  Write-Host "[mysql-gate] $message"
}

function Write-Block([string]$message) {
  Write-Host "[mysql-gate] BLOCKED: $message" -ForegroundColor Red
}

function Read-TestCredential {
  $secure = Read-Host 'MySQL test account password (modern_erp_test)' -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Save-DpapiCredential([string]$plainText, [string]$path) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($plainText)
  try {
    $protected = [System.Security.Cryptography.ProtectedData]::Protect(
      $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $path)) | Out-Null
    [System.IO.File]::WriteAllBytes($path, $protected)
  } finally {
    if ($bytes) { [System.Array]::Clear($bytes, 0, $bytes.Length) }
  }
}

# Runs a native helper. stdout and stderr are captured into separate files on
# purpose: a native command that writes to stderr must not be turned into a
# terminating PowerShell error, and the real error text must survive.
function Invoke-NodeHelper {
  param([string]$HelperPath, [hashtable]$Environment)

  $stdoutFile = [System.IO.Path]::GetTempFileName()
  $stderrFile = [System.IO.Path]::GetTempFileName()
  try {
    foreach ($name in $Environment.Keys) { Set-Item -Path "Env:\$name" -Value $Environment[$name] }
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $process = Start-Process -FilePath 'node' -ArgumentList $HelperPath -NoNewWindow -Wait -PassThru `
      -WorkingDirectory $repoRoot -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    $ErrorActionPreference = $previousPreference
    $stdoutText = (Get-Content -Raw -Encoding UTF8 $stdoutFile) -replace "`0", ''
    $stderrText = (Get-Content -Raw -Encoding UTF8 $stderrFile) -replace "`0", ''
    return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdoutText; Stderr = $stderrText }
  } finally {
    Remove-Item Env:\ERP_DB_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\MYSQL_LOCAL_BASELINE_PATH -ErrorAction SilentlyContinue
    Remove-Item $stdoutFile, $stderrFile -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path $baselineHelper)) {
  Write-Block "the baseline helper is missing ($baselineHelper)"
  exit 1
}

$existing = $null
if (Test-Path $baselinePath) {
  try { $existing = Get-Content -Raw -Encoding UTF8 $baselinePath | ConvertFrom-Json }
  catch { $existing = $null }
}

Write-Step 'Target = mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test'
Write-Step 'A masked local prompt follows. The password is used in this process only and is never stored in plaintext.'

$accepted = $null
$probePath = ''
$lastError = ''

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
  $password = Read-TestCredential
  if ([string]::IsNullOrEmpty($password)) {
    Write-Block 'no password was supplied.'
    exit 2
  }

  $probePath = Join-Path ([System.IO.Path]::GetTempPath()) ("mysql-local-baseline-{0}.json" -f [System.Guid]::NewGuid().ToString('N'))
  $run = Invoke-NodeHelper -HelperPath $baselineHelper -Environment @{
    ERP_DB_HOST = '127.0.0.1'
    ERP_DB_PORT = '3306'
    ERP_DB_NAME = 'modern_erp_domain_test'
    ERP_DB_USER = 'modern_erp_test'
    ERP_DB_PASSWORD = $password
    MYSQL_LOCAL_BASELINE_PATH = $probePath
  }

  if ($run.ExitCode -eq 0) {
    $accepted = $run.Stdout
    break
  }

  $lastError = if ($run.Stderr) { ($run.Stderr -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 3) -join ' | ' }
               else { "the baseline helper exited with code $($run.ExitCode)" }
  Remove-Item $probePath -ErrorAction SilentlyContinue
  if ($attempt -lt $MaxAttempts) {
    Write-Block "the attempt failed: $lastError"
    Write-Step 'Please try again. Nothing was written.'
  }
}

if ($null -eq $accepted) {
  Write-Block "the target could not be verified: $lastError"
  exit 3
}

$probe = ($accepted -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 1) | ConvertFrom-Json
$candidate = $probe.baseline

# The baseline is compared, never silently replaced. A drifted identity is
# reported; only an explicit -ForceBaseline re-establishes it.
$drift = @()
if ($null -ne $existing) {
  foreach ($field in @('database', 'currentUser', 'serverUuid', 'grantsSha256')) {
    if ([string]$existing.$field -ne [string]$candidate.$field) { $drift += $field }
  }
}

if ($drift.Count -gt 0 -and -not $ForceBaseline) {
  Write-Block "the live identity no longer matches the frozen baseline (drifted: $($drift -join ', '))."
  Write-Step 'Re-run with -ForceBaseline only when the change is intended and understood.'
  Remove-Item $probePath -ErrorAction SilentlyContinue
  exit 4
}

Save-DpapiCredential -plainText $password -path $credentialPath

# Promote the verified candidate as the fixed baseline.
[System.IO.Directory]::CreateDirectory($localDir) | Out-Null
if ($drift.Count -eq 0 -and $null -ne $existing) {
  # Identical identity: keep the original baseline so `establishedAt` stays
  # the moment the identity was first proven.
  Write-Step 'The live identity matches the frozen baseline; the baseline was left unchanged.'
} else {
  Copy-Item -LiteralPath $probePath -Destination $baselinePath -Force
}
Remove-Item $probePath -ErrorAction SilentlyContinue

Write-Step ''
Write-Step 'UNIFIED MYSQL TEST TARGET = READY'
Write-Step "  schema        : $($candidate.database)"
Write-Step "  account       : $($candidate.currentUser)"
Write-Step "  server version: $($candidate.serverVersion)"
Write-Step "  server uuid   : $($candidate.serverUuid)"
Write-Step "  grants sha256 : $($candidate.grantsSha256)"
Write-Step "  credential    : $credentialPath (DPAPI, current Windows user)"
Write-Step "  baseline      : $baselinePath"
Write-Step ''
Write-Step 'Run a MySQL gate with:'
Write-Step '  pnpm test:mysql:local'
exit 0
