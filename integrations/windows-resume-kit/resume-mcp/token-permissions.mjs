import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { win32 } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ACL_ERROR = 'data/token 的 Windows ACL 必须禁用继承，且仅允许当前用户、SYSTEM 或 Administrators 访问；请重新运行安装脚本修复权限。';

// Use SIDs, not localized account names. Deny entries cannot grant access.
export function validateWindowsTokenAcl(acl) {
  const sid = acl?.currentSid;
  if (typeof sid !== 'string' || !/^S-1-\d+(?:-\d+)+$/.test(sid)) throw new Error(ACL_ERROR);
  const allowed = new Set([sid, 'S-1-5-18', 'S-1-5-32-544']);
  if (acl.protected !== true || !allowed.has(acl.ownerSid) || !Array.isArray(acl.rules)) throw new Error(ACL_ERROR);
  let readableByUser = false;
  for (const rule of acl.rules) {
    if (!['Allow', 'Deny'].includes(rule?.type) || typeof rule.sid !== 'string') throw new Error(ACL_ERROR);
    if (rule.type !== 'Allow') continue;
    if (!allowed.has(rule.sid) || rule.inherited !== false || !Number.isSafeInteger(rule.rights)) throw new Error(ACL_ERROR);
    if (rule.sid === sid && rule.inheritOnly === false && (rule.rights & 1) === 1) readableByUser = true;
  }
  if (!readableByUser) throw new Error(ACL_ERROR);
}

// Read only: no token bytes are read by PowerShell and no ACL is changed here.
const ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$path = $env:RESUME_TOKEN_ACL_PATH
$item = Get-Item -LiteralPath $path -Force
if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Token must be a regular file.' }
$acl = Get-Acl -LiteralPath $path
$sidType = [System.Security.Principal.SecurityIdentifier]
$rules = @($acl.GetAccessRules($true, $true, $sidType) | ForEach-Object {
  @{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); rights = [long]$_.FileSystemRights; inherited = $_.IsInherited; inheritOnly = (($_.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) }
})
@{ currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; ownerSid = $acl.GetOwner($sidType).Value; protected = $acl.AreAccessRulesProtected; rules = $rules } | ConvertTo-Json -Depth 4 -Compress
`;

export async function assertPrivateTokenFile(tokenPath) {
  const details = await lstat(tokenPath);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error('data/token 必须是普通文件，不能是符号链接。');
  if (process.platform !== 'win32') {
    if ((details.mode & 0o077) !== 0) throw new Error('data/token 必须是仅当前用户可读写的文件（chmod 600）。');
    return;
  }
  try {
    const executable = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const { stdout } = await execFileAsync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ACL_SCRIPT, 'utf16le').toString('base64')], {
      env: { ...process.env, RESUME_TOKEN_ACL_PATH: tokenPath }, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true,
    });
    validateWindowsTokenAcl(JSON.parse(stdout.replace(/^\uFEFF/, '')));
  } catch {
    throw new Error(ACL_ERROR);
  }
}
