import { DEFAULT_SETTINGS, type AgentSettings } from './settings';

const BLOCKED_HOSTS = [
  'chromewebstore.google.com',
  'chrome.google.com',
  'microsoftedge.microsoft.com',
];

const SENSITIVE_PATH = /(password|passwd|payment|checkout|wallet|bank|2fa|otp)/i;

const SECRET_PATTERNS: Array<[RegExp, string, personalData?: boolean]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]', true],
  [/\b1[3-9]\d{9}\b/g, '[redacted-phone]', true],
  [/\b(?:sk|rk|pk|ak)-[A-Za-z0-9_-]{16,}\b/g, '[redacted-key]'],
  [/\b(?:AIza|ya29|ghp_|github_pat_)[A-Za-z0-9_\-]{10,}\b/g, '[redacted-token]'],
  [/\b\d{13,19}\b/g, '[redacted-number]', true],
];

export function redactText(text: string, options: { preservePersonalData?: boolean } = {}): string {
  return SECRET_PATTERNS.reduce(
    (value, [pattern, replacement, personalData]) =>
      options.preservePersonalData === true && personalData ? value : value.replace(pattern, replacement),
    text,
  );
}

export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T;
  if (!value || typeof value !== 'object') return value;
  const redacted = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, redactValue(item)]),
  );
  return redacted as T;
}

export function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/(token|secret|password|passwd|key|auth|code|session|email)/i.test(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return redactText(url.toString());
  } catch {
    return redactText(raw);
  }
}

export function assertNavigableUrl(url: string, settings: AgentSettings = DEFAULT_SETTINGS): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`非法 URL：${url}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`禁止导航到 ${parsed.protocol} 页面`);
  }

  if (BLOCKED_HOSTS.includes(parsed.hostname)) {
    throw new Error('禁止操作浏览器商店或受保护域名');
  }

  if (SENSITIVE_PATH.test(parsed.pathname + parsed.search)) {
    throw new Error('当前策略禁止自动进入密码、支付或验证相关页面');
  }

  if (!settings.allowCrossOrigin && parsed.protocol === 'http:' && parsed.hostname !== 'localhost') {
    throw new Error('未开启跨站权限时禁止导航到非本地 HTTP 页面');
  }
}

export function isRepeatedAction(
  history: Array<{ name: string; args: string }>,
  name: string,
  args: unknown,
  limit = 3,
): boolean {
  const encoded = JSON.stringify(args ?? {});
  const tail = history.slice(-limit);
  return tail.length >= limit && tail.every((item) => item.name === name && item.args === encoded);
}
