. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Windows
$null = Get-InstallSettings
$tokenPath = Join-Path (Get-KitRoot) 'resume-mcp\data\token'
$token = [IO.File]::ReadAllText($tokenPath).Trim()
try {
    $resume = Invoke-RestMethod -Uri 'http://127.0.0.1:17360/health' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 5
    if ($resume.ok -ne $true -or $resume.service -ne 'local-resume') { throw 'Unexpected Resume MCP response.' }
    Write-Host 'Resume MCP: ready (authenticated health check).'
} catch { throw 'Resume MCP health check failed. Inspect its service window; no token is printed.' }
finally { $token = $null }
try {
    $pagent = Invoke-RestMethod -Uri 'http://127.0.0.1:17344/health' -TimeoutSec 5
    if ($pagent.ok -ne $true -or $pagent.directBrowser -ne $true -or $pagent.port -ne 17344) { throw 'Unexpected Pagent Host response.' }
    Write-Host "Pagent Host: ready. Extension connected: $($pagent.extensionConnected)"
    if ($pagent.extensionConnected -ne $true) { Write-Warning 'Open the extension and confirm its local MCP Host connection; browser actions are not ready yet.' }
} catch { throw 'Pagent Host health check failed. Inspect its service window.' }
Write-Host 'This checks local connections only; it does not fill, submit, or send anything.'
