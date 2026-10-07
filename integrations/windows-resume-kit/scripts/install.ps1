[CmdletBinding()]
param([Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Windows
Assert-Node
$kitRoot = Get-KitRoot
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd was not found. Reinstall Node.js with npm.' }
foreach ($relative in @('pagent\dist\manifest.json', 'pagent-host\index.mjs', 'resume-mcp\server.mjs')) {
    if (-not (Test-Path -LiteralPath (Join-Path $kitRoot $relative))) { throw "Missing kit file: $relative" }
}
$data = Initialize-PrivateData
& node.exe (Join-Path $PSScriptRoot 'initialize-data.mjs') --extension-id $ExtensionId
if ($LASTEXITCODE -ne 0) { throw 'Local data initialization failed.' }
Protect-PrivateDataTree $data
& node.exe (Join-Path $PSScriptRoot 'check-private-data.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Private token ACL verification failed.' }
foreach ($relative in @('pagent-host', 'resume-mcp')) {
    Push-Location (Join-Path $kitRoot $relative)
    try {
        if (Test-Path -LiteralPath 'package-lock.json') { & npm.cmd ci --ignore-scripts --omit=dev --no-audit --no-fund }
        else { & npm.cmd install --ignore-scripts --omit=dev --no-audit --no-fund }
        if ($LASTEXITCODE -ne 0) { throw "npm dependency installation failed in $relative." }
    } finally { Pop-Location }
}
$codexRoot = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) { Join-Path $env:USERPROFILE '.codex' } else { $env:CODEX_HOME }
$skillsRoot = Join-Path $codexRoot 'skills'
if (-not (Test-Path -LiteralPath $skillsRoot)) { New-Item -ItemType Directory -Path $skillsRoot -Force | Out-Null }
$normalizedRoot = $kitRoot.Replace('\', '/')
foreach ($source in Get-ChildItem -LiteralPath (Join-Path $kitRoot 'skills') -Directory) {
    $destination = Join-Path $skillsRoot $source.Name
    if (Test-Path -LiteralPath $destination) {
        Write-Warning "Existing skill preserved: $destination. Review and merge the kit version manually."
        continue
    }
    Copy-Item -LiteralPath $source.FullName -Destination $destination -Recurse
    foreach ($markdown in Get-ChildItem -LiteralPath $destination -Recurse -File -Filter '*.md') {
        $content = [IO.File]::ReadAllText($markdown.FullName).Replace('__INSTALL_ROOT__', $normalizedRoot)
        Write-Utf8File $markdown.FullName $content
    }
    Write-Host "Installed skill: $($source.Name)"
}
$config = @'
# Merge this section into your existing Codex config.toml; do not replace the whole file.
[mcp_servers.pagent]
url = "http://127.0.0.1:17344/mcp"
tool_timeout_sec = 330
'@
Write-Utf8File (Join-Path $kitRoot 'codex-mcp.fragment.toml') $config
Write-Host 'Local preparation completed. No browser settings or Codex config were changed.'
Write-Host 'Next: follow INSTALL.md to add your own resume, merge the Codex fragment, and connect the extension.'
Write-Host "Private extension configuration file: $data\pagent-resume-config.json"
Write-Host 'The configuration contains a local secret. Do not paste it into chat or send it to others.'
