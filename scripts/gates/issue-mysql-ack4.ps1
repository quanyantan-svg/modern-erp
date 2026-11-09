param(
  [Parameter(Mandatory=$true)][string]$ApprovalFile,
  [Parameter(Mandatory=$true)][string]$OutputFile
)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security -ErrorAction Stop
    $null = [System.Security.Cryptography.ProtectedData]
}
catch {
    throw "ACK-4 issuer: DPAPI assembly load failed: $($_.Exception.Message)"
}
$approval = Get-Content -LiteralPath $ApprovalFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($approval.version -ne 1) { throw 'ACK-4 issuer: approval version must be 1' }
if (-not ([guid]::TryParse([string]$approval.runId, [ref]([guid]::Empty)))) { throw 'ACK-4 issuer: runId must be a UUID' }
$issued = [DateTimeOffset]::Parse([string]$approval.issuedAt)
$expires = [DateTimeOffset]::Parse([string]$approval.expiresAt)
if ($expires -le $issued -or ($expires - $issued).TotalMinutes -gt 15) { throw 'ACK-4 issuer: consumption window must be positive and at most 15 minutes' }
$plain = [Text.Encoding]::UTF8.GetBytes(($approval | ConvertTo-Json -Depth 20 -Compress))
$cipher = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
$directory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputFile))
[IO.Directory]::CreateDirectory($directory) | Out-Null
[IO.File]::WriteAllBytes($OutputFile, $cipher)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
$acl.AddAccessRule($rule)
[IO.File]::SetAccessControl($OutputFile, $acl)
Write-Output "ACK-4 capability issued for run $($approval.runId); issuer does not approve the run."
