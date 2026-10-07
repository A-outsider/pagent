export async function captureVisibleTab(windowId?: number): Promise<string> {
  if (windowId == null) {
    return browser.tabs.captureVisibleTab({ format: 'png' });
  }
  return browser.tabs.captureVisibleTab(windowId, { format: 'png' });
}

export function trimDataUrl(dataUrl: string, max = 180_000): string {
  if (dataUrl.length <= max) return dataUrl;
  return `${dataUrl.slice(0, max)}…[truncated ${dataUrl.length - max} chars]`;
}
