Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-KitRoot {
    return (Split-Path -Parent $PSScriptRoot)
}

function Assert-Windows {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Run this script on Windows PowerShell 5.1 or PowerShell on Windows.'
    }
}

function Assert-Node {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js 24 or later, then open a new PowerShell window.'
    }
    $major = & node.exe -p 'process.versions.node.match(/^\d+/)[0]'
    if ($LASTEXITCODE -ne 0 -or [int]$major -lt 24) {
        throw 'Node.js 24 or later is required.'
    }
}

function Write-Utf8File([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

function Set-PrivatePathAccess([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing a symlink/junction: $Path"
    }
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    if ($item.PSIsContainer) {
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    } else {
        $acl = New-Object Security.AccessControl.FileSecurity
        $inherit = [Security.AccessControl.InheritanceFlags]::None
    }
    $acl.SetOwner($userSid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($userSid, $systemSid)) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Protect-PrivateDataTree([string]$Path) {
    Set-PrivatePathAccess $Path
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $Path -Force) { Protect-PrivateDataTree $child.FullName }
    }
}

function Initialize-PrivateData {
    $data = Join-Path (Get-KitRoot) 'resume-mcp\data'
    if (-not (Test-Path -LiteralPath $data)) { New-Item -ItemType Directory -Path $data | Out-Null }
    Set-PrivatePathAccess $data
    $attachments = Join-Path $data 'attachments'
    if (-not (Test-Path -LiteralPath $attachments)) { New-Item -ItemType Directory -Path $attachments | Out-Null }
    Set-PrivatePathAccess $attachments
    return $data
}

function Assert-PortFree([int]$Port) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() }
    catch { throw "127.0.0.1:$Port is already in use. Inspect the existing process; this kit will not stop it." }
    finally { $listener.Stop() }
}

function Get-InstallSettings {
    $file = Join-Path (Get-KitRoot) 'resume-mcp\data\windows-install.json'
    if (-not (Test-Path -LiteralPath $file)) { throw 'Run scripts\install.ps1 -ExtensionId <id> first.' }
    $settings = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($settings.extensionId -notmatch '^[a-p]{32}$') { throw 'Invalid saved Chrome extension ID.' }
    $currentRoot = (Get-KitRoot).Replace('\', '/')
    if ($settings.installRoot -ne $currentRoot) { throw 'The kit has moved. Run install.ps1 again at the new permanent location.' }
    return $settings
}
