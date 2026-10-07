import { openTabsBackgroundSchema, type OpenTabsBackgroundInput } from '@/shared/contracts/background-tabs';
import { toErrorMessage } from '@/shared/contracts/errors';
import { assertNavigableUrl } from '@/shared/contracts/policy';
import type { AgentSettings } from '@/shared/contracts/settings';

function normalizeUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.username || url.password) throw new Error('链接不能包含用户名或密码');
  return url.href;
}

export async function openTabsBackground(input: OpenTabsBackgroundInput, settings: AgentSettings) {
  const data = openTabsBackgroundSchema.parse(input);
  // Validate the whole batch before opening any tab. Preserve query strings and
  // hashes: recruiting sites often use them to identify distinct job pages.
  const urls = [...new Set(data.urls.map((raw) => {
    const url = normalizeUrl(raw);
    assertNavigableUrl(url, settings);
    return url;
  }))];
  const opened: Array<{ tabId: number; url: string }> = [];
  const existing: Array<{ tabId: number; url: string }> = [];
  const failed: Array<{ url: string; error: string }> = [];
  let windowId = data.windowId;
  const createdWindow = windowId == null;

  if (windowId == null) {
    const created = await browser.windows.create({ url: urls, focused: false, type: 'normal' });
    if (created?.id == null) throw new Error('创建后台窗口未返回窗口 ID');
    windowId = created.id;
    const tabs = (created.tabs ?? [])
      .slice().sort((left, right) => left.index - right.index);
    urls.forEach((url, index) => {
      const tabId = tabs[index]?.id;
      if (tabId != null) opened.push({ tabId, url });
      else failed.push({ url, error: '窗口已创建，但未取得此标签页 ID；请先用 list_tabs 核对，不要直接重试' });
    });
  } else {
    const target = await browser.windows.get(windowId);
    if (target.type !== 'normal') throw new Error('目标必须是普通浏览器窗口');
    const byUrl = new Map<string, number>();
    for (const tab of await browser.tabs.query({ windowId })) {
      if (tab.id == null) continue;
      try {
        const url = normalizeUrl(tab.pendingUrl || tab.url || '');
        if (!byUrl.has(url)) byUrl.set(url, tab.id);
      } catch { /* Unrelated protected or unavailable URLs are left alone. */ }
    }
    for (const url of urls) {
      const existingId = byUrl.get(url);
      if (existingId != null) {
        existing.push({ tabId: existingId, url });
        continue;
      }
      try {
        const tab = await browser.tabs.create({ url, windowId, active: false });
        if (tab.id == null) throw new Error('未取得新标签页 ID；请先用 list_tabs 核对');
        opened.push({ tabId: tab.id, url });
      } catch (error) {
        failed.push({ url, error: toErrorMessage(error) });
      }
    }
  }

  let group: { status: string; groupId?: number; name?: string; message?: string } = { status: 'not_requested' };
  if (data.groupName && opened.length) {
    try {
      if (!await browser.permissions.contains({ permissions: ['tabGroups'] })) {
        group = { status: 'permission_required', name: data.groupName, message: '标签页已打开；尚无 tabGroups 权限，未创建或命名标签组' };
      } else {
        const groupId = await browser.tabs.group({
          tabIds: [opened[0]!.tabId, ...opened.slice(1).map((tab) => tab.tabId)],
          createProperties: { windowId },
        });
        group = { status: 'created', groupId, name: data.groupName };
        await browser.tabGroups.update(groupId, { title: data.groupName });
      }
    } catch (error) {
      group = { ...group, status: 'failed', name: data.groupName, message: toErrorMessage(error) };
    }
  } else if (data.groupName) {
    group = { status: 'no_new_tabs', name: data.groupName, message: '所有链接已存在，原标签及分组保持不变' };
  }
  return { windowId, createdWindow, opened, existing, failed, duplicateCount: data.urls.length - urls.length, group };
}
