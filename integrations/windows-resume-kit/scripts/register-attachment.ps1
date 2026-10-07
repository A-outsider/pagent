[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('resume-pdf', 'resume-image', 'avatar')][string]$Id,
    [Parameter(Mandatory = $true)][string]$Path
)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Windows
Assert-Node
$null = Get-InstallSettings
$data = Initialize-PrivateData
& node.exe (Join-Path $PSScriptRoot 'register-attachment.mjs') --id $Id --file $Path
if ($LASTEXITCODE -ne 0) { throw 'Attachment registration failed. Existing entries were not overwritten.' }
Set-PrivatePathAccess (Join-Path $data 'attachments.json')
