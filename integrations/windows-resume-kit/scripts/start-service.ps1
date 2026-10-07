[CmdletBinding()]
param([Parameter(Mandatory = $true)][ValidateSet('pagent', 'resume')][string]$Service)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Windows
Assert-Node
$settings = Get-InstallSettings
$env:PAGENT_EXTENSION_ID = $settings.extensionId
$kitRoot = Get-KitRoot
if ($Service -eq 'pagent') {
    Assert-PortFree 17344
    $Host.UI.RawUI.WindowTitle = 'Pagent MCP - close this window to stop'
    & node.exe (Join-Path $kitRoot 'pagent-host\index.mjs') --port 17344 --strict-port --http-only
} else {
    Assert-PortFree 17360
    $Host.UI.RawUI.WindowTitle = 'Resume MCP - close this window to stop'
    & node.exe (Join-Path $kitRoot 'resume-mcp\server.mjs')
}
if ($LASTEXITCODE -ne 0) { throw "$Service exited with code $LASTEXITCODE. Read the service error above." }
