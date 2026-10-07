import { originOf } from '@/shared/utils/utils';
import type { PermissionState } from '@/shared/contracts/settings';

const ALL_SITES = ['https://*/*', 'http://*/*'];

export async function getPermissionState(): Promise<PermissionState> {
  const allSites = await browser.permissions.contains({ origins: ALL_SITES });
  const debuggerGranted = await browser.permissions.contains({ permissions: ['debugger'] });
  const tabsGranted = await browser.permissions.contains({ permissions: ['tabs'] });
  const current = await browser.permissions.getAll();
  return {
    allSites,
    debugger: debuggerGranted,
    tabs: tabsGranted,
    origins: current.origins ?? [],
  };
}

export async function requestPermissions(options: {
  allSites?: boolean;
  debugger?: boolean;
  tabs?: boolean;
  origins?: string[];
}): Promise<PermissionState> {
  const permissions: string[] = [];
  const origins: string[] = [];

  if (options.debugger) permissions.push('debugger');
  if (options.tabs) permissions.push('tabs');
  if (options.allSites) origins.push(...ALL_SITES);
  if (options.origins) {
    for (const value of options.origins) {
      const origin = value.includes('://') ? originOf(value) : value;
      if (origin) origins.push(`${origin}/*`);
    }
  }

  if (permissions.length || origins.length) {
    const granted = await browser.permissions.request({
      permissions: permissions as Parameters<typeof browser.permissions.request>[0]['permissions'],
      origins,
    });
    if (!granted) return getPermissionState();
  }

  return getPermissionState();
}

export async function ensureOriginAccess(url: string): Promise<void> {
  const origin = originOf(url);
  if (!origin) throw new Error('无法解析目标地址');
  const granted =
    (await browser.permissions.contains({ origins: [`${origin}/*`] })) ||
    (await browser.permissions.contains({ origins: ALL_SITES }));
  if (granted) return;
  throw new Error(`尚未授予 ${origin} 的访问权限，请先在设置中开启站点权限`);
}
