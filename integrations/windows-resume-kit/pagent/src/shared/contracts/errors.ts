export class PagentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PagentError';
    this.code = code;
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function toUserErrorMessage(error: unknown): string {
  const message = toErrorMessage(error);
  if (/recursion limit/i.test(message) || /GRAPH_RECURSION/i.test(message)) {
    return '步骤过多，已自动停止。请把任务拆小后重试。';
  }
  if (/chrome\.debugger|调试器权限/i.test(message)) {
    return '当前后台还不能使用调试器。请到 chrome://extensions 重新加载 Pagent，并允许「调试器」权限。';
  }
  if (/quota reached|rate limit|429|MODEL_RATE_LIMIT/i.test(message)) {
    return `模型请求触发速率或配额限制（429）。${message}`;
  }
  return message;
}

export function isProtectedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'chrome:' ||
      parsed.protocol === 'chrome-extension:' ||
      parsed.protocol === 'edge:' ||
      parsed.protocol === 'about:' ||
      parsed.hostname === 'chrome.google.com' ||
      parsed.hostname === 'microsoftedge.microsoft.com'
    );
  } catch {
    return true;
  }
}
