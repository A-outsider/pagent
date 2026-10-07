export async function openDetailedSettings(section: 'general' | 'archive' = 'general') {
  const url = browser.runtime.getURL(`/options.html#${section}`);
  const existing = await browser.tabs.query({ url: browser.runtime.getURL('/options.html') });
  const current = existing[0];
  if (current?.id) {
    await browser.tabs.update(current.id, { url, active: true });
    if (current.windowId != null) await browser.windows.update(current.windowId, { focused: true });
    return;
  }
  await browser.tabs.create({ url, active: true });
}
