const active = new Set<number>();
export const isDirectBrowserBusy = (tabId: number) => active.has(tabId);
export async function withDirectBrowserLock<T>(tabIds: number[], work: () => Promise<T>): Promise<T> {
  const targets = [...new Set(tabIds)];
  if (targets.some(isDirectBrowserBusy)) throw new Error('此标签页有直接浏览器操作尚未结束，请等结果返回后继续');
  targets.forEach((id) => active.add(id));
  try { return await work(); }
  finally { targets.forEach((id) => active.delete(id)); }
}
