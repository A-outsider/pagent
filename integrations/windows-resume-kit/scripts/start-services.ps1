. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Windows
Assert-Node
$null = Get-InstallSettings
Assert-PortFree 17344
Assert-PortFree 17360
$serviceScript = Join-Path $PSScriptRoot 'start-service.ps1'
foreach ($service in @('resume', 'pagent')) {
    $arguments = '-NoExit -NoProfile -ExecutionPolicy Bypass -File "' + $serviceScript + '" -Service ' + $service
    Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments | Out-Null
}
Write-Host 'Two service windows were requested. Keep them open and inspect startup errors.'
Write-Host 'Run scripts\check-services.ps1 for a read-only connectivity check.'
Write-Host 'ExecutionPolicy Bypass applies only to the two new processes; no system/user policy was changed.'
