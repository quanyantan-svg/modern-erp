# Explicit recovery of an OUT-001 quarantined disposable schema.
# Requires a fresh ACK4_RECOVERY_V1 capability. This script cannot run fixtures.
param(
  [Parameter(Mandatory=$true)][string]$RunId,
  [Parameter(Mandatory=$true)][string]$Ack4Capability
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not (Test-Path -LiteralPath $Ack4Capability)) { throw 'OUT_001_RECOVERY_CAPABILITY_MISSING' }
Add-Type -AssemblyName System.Security
$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$local = Join-Path $env:LOCALAPPDATA 'ModernERP\mysql-gate'
$baseline = Get-Content -LiteralPath (Join-Path $local 'target.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$plain = [Security.Cryptography.ProtectedData]::Unprotect(
  [IO.File]::ReadAllBytes((Join-Path $local 'credential.dat')), $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser)
$password = [Text.Encoding]::UTF8.GetString($plain)
[Array]::Clear($plain, 0, $plain.Length)
function ConvertTo-NativeArgument([string]$Argument) {
  if ($Argument -notmatch '[\s"]') { return $Argument }
  $escaped = [regex]::Replace($Argument, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  $quote = [char]34
  return $quote + $escaped + $quote
}
$proofPath = $null
$mutex = $null
try {
  $env:ERP_DB_HOST = $baseline.host
  $env:ERP_DB_PORT = [string]$baseline.port
  $env:ERP_DB_NAME = $baseline.database
  $env:ERP_DB_USER = $baseline.user
  $env:ERP_DB_PASSWORD = $password
  $env:ERP_DB_BACKEND = 'mysql'
  $env:ERP_TEST_DB_BACKEND = 'mysql'
  $env:MYSQL_LOCAL_BASELINE_PATH = Join-Path $local 'target.json'
  $preflight = & node (Join-Path $repo 'scripts\gates\mysql-local-preflight.mjs') --recovery-inspection
  if ($LASTEXITCODE -ne 0) { throw 'OUT_001_RECOVERY_PREFLIGHT_FAILED' }
  $live = $preflight | ConvertFrom-Json
  if ($live.ok -ne $true -or @($live.drift).Count -ne 0) { throw 'OUT_001_RECOVERY_TARGET_DRIFT' }
  $proofPath = [IO.Path]::GetTempFileName()
  $proof = [ordered]@{
    host = [string]$baseline.host; port = [int]$baseline.port
    database = [string]$baseline.database; user = [string]$baseline.user
    selectedDatabase = [string]$live.identity.database
    currentUser = [string]$live.identity.currentUser
    serverUuid = [string]$live.identity.serverUuid
    grantsSha256 = [string]$live.identity.grantsSha256
  }
  [IO.File]::WriteAllText($proofPath, ($proof | ConvertTo-Json -Compress),
    (New-Object Text.UTF8Encoding($false)))
  $name = "Global\ModernERP.MySqlGate.$($baseline.database)"
  $created = $false
  $mutex = [Threading.Mutex]::new($false, $name, [ref]$created)
  if (-not $mutex.WaitOne(0)) { throw 'OUT_001_RECOVERY_TARGET_LOCKED' }
  $env:ERP_MYSQL_TEST_ALLOW_RESET = 'true'
  $env:ERP_MYSQL_TEST_DISPOSABLE_TARGET = $baseline.disposableTarget
  $env:ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS = 'DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP'
  $args = @(
    (Join-Path $repo 'scripts\gates\mysql-out001-recovery.mjs'),
    '--run-id', $RunId, '--ack4-capability', ([IO.Path]::GetFullPath($Ack4Capability)),
    '--target-proof', $proofPath
  )
  # PowerShell 5.1 Start-Process flattens ArgumentList. Quote every native arg.
  $quoted = $args | ForEach-Object { ConvertTo-NativeArgument $_ }
  $out = [IO.Path]::GetTempFileName()
  $err = [IO.Path]::GetTempFileName()
  try {
    $process = Start-Process -FilePath 'node' -ArgumentList $quoted -WindowStyle Hidden -Wait -PassThru `
      -WorkingDirectory $repo -RedirectStandardOutput $out -RedirectStandardError $err
    $stdout = Get-Content -LiteralPath $out -Raw -Encoding UTF8
    $stderr = Get-Content -LiteralPath $err -Raw -Encoding UTF8
    if ($stdout) { Write-Host $stdout.Trim() }
    if ($stderr) { Write-Host $stderr.Trim() }
    if ($process.ExitCode -ne 0) { throw "OUT_001_RECOVERY_FAILED:$($process.ExitCode)" }
  } finally {
    Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
  }
} finally {
  foreach ($key in @('ERP_DB_HOST','ERP_DB_PORT','ERP_DB_NAME','ERP_DB_USER','ERP_DB_PASSWORD',
    'ERP_DB_BACKEND','ERP_TEST_DB_BACKEND','MYSQL_LOCAL_BASELINE_PATH',
    'ERP_MYSQL_TEST_ALLOW_RESET','ERP_MYSQL_TEST_DISPOSABLE_TARGET','ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS')) {
    Remove-Item "Env:\$key" -ErrorAction SilentlyContinue
  }
  $password = $null
  if ($proofPath) { Remove-Item -LiteralPath $proofPath -Force -ErrorAction SilentlyContinue }
  if ($mutex) { try { $mutex.ReleaseMutex() } catch {}; $mutex.Dispose() }
}
