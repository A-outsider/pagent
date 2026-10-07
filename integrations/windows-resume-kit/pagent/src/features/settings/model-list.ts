import {
  PROVIDER_PRESETS,
  type ApiProtocol,
  type CatalogModel,
  type ProviderId,
} from '@/shared/contracts/settings';

export type FetchModelsOptions = {
  apiKey?: string;
  baseURL?: string;
  force?: boolean;
};

const MODEL_LIST_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { models: CatalogModel[]; at: number }>();

function cacheKey(provider: ProviderId, baseURL: string): string {
  return `${provider}\u0000${baseURL}`;
}

export function clearModelListCache(): void {
  cache.clear();
}

function stripSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

async function readJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(`无法连接到模型服务：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200).replace(/\s+/g, ' ').trim();
    } catch {
      // ignore
    }
    const status =
      response.status === 401 || response.status === 403
        ? 'API Key 无效或无权限'
        : response.status === 404
          ? '端点不支持模型列表接口'
          : response.status === 429
            ? '请求过于频繁（429）'
            : `HTTP ${response.status}`;
    throw new Error(`获取模型列表失败（${status}）${detail ? `：${detail}` : ''}`);
  }
  return response.json();
}

export function parseOpenAICompatModels(
  data: unknown,
  tag: string,
  defaultProtocol: ApiProtocol,
  protocolFor?: (id: string) => ApiProtocol,
): CatalogModel[] {
  const rows = (data as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) throw new Error('响应缺少 data 数组，不符合 OpenAI 兼容规范');
  const models: CatalogModel[] = [];
  for (const row of rows) {
    const id =
      typeof row === 'object' && row !== null && typeof (row as { id?: unknown }).id === 'string'
        ? (row as { id: string }).id
        : '';
    if (!id) continue;
    models.push({
      id,
      label: id,
      tag,
      apiProtocol: protocolFor ? protocolFor(id) : defaultProtocol,
    });
  }
  return models;
}

export function parseAnthropicModels(data: unknown): CatalogModel[] {
  const rows = (data as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) throw new Error('Anthropic 响应缺少 data 数组');
  const models: CatalogModel[] = [];
  for (const row of rows) {
    const item = row as { id?: unknown; display_name?: unknown } | null;
    if (!item || typeof item.id !== 'string') continue;
    models.push({
      id: item.id,
      label: typeof item.display_name === 'string' && item.display_name ? item.display_name : item.id,
      tag: 'Anthropic',
      apiProtocol: 'chat-completions',
    });
  }
  return models;
}

export function parseGoogleModels(data: unknown): CatalogModel[] {
  const rows = (data as { models?: unknown } | null)?.models;
  if (!Array.isArray(rows)) throw new Error('Gemini 响应缺少 models 数组');
  const models: CatalogModel[] = [];
  for (const row of rows) {
    const item = row as {
      name?: unknown;
      displayName?: unknown;
      supportedGenerationMethods?: unknown;
    } | null;
    if (!item || typeof item.name !== 'string' || !item.name) continue;
    const methods = item.supportedGenerationMethods;
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue;
    const id = item.name.startsWith('models/') ? item.name.slice('models/'.length) : item.name;
    if (!id) continue;
    models.push({
      id,
      label: typeof item.displayName === 'string' && item.displayName ? item.displayName : id,
      tag: 'Gemini',
      apiProtocol: 'chat-completions',
    });
  }
  return models;
}

export function parseOllamaModels(data: unknown): CatalogModel[] {
  const rows = (data as { models?: unknown } | null)?.models;
  if (!Array.isArray(rows)) throw new Error('Ollama 响应缺少 models 数组');
  const models: CatalogModel[] = [];
  for (const row of rows) {
    const item = row as { name?: unknown; model?: unknown } | null;
    if (!item) continue;
    const id =
      typeof item.name === 'string' && item.name
        ? item.name
        : typeof item.model === 'string'
          ? item.model
          : '';
    if (!id) continue;
    models.push({ id, label: id, tag: 'Ollama', apiProtocol: 'chat-completions' });
  }
  return models;
}

function requireApiKey(provider: ProviderId, apiKey: string | undefined): string {
  if (!apiKey?.trim()) {
    throw new Error(`尚未配置 ${PROVIDER_PRESETS[provider].label} 的 API Key`);
  }
  return apiKey.trim();
}

async function fetchOpenAICompatModels(
  provider: ProviderId,
  apiKey: string | undefined,
  base: string,
): Promise<CatalogModel[]> {
  const preset = PROVIDER_PRESETS[provider];
  const headers: Record<string, string> = apiKey?.trim()
    ? { Authorization: `Bearer ${apiKey.trim()}` }
    : {};
  const data = await readJson(`${stripSlash(base)}/models`, { headers });
  return parseOpenAICompatModels(
    data,
    preset.label,
    preset.apiProtocol,
    provider === 'openai'
      ? (id) => (/^o[134]/i.test(id) ? 'responses' : 'chat-completions')
      : undefined,
  );
}

async function fetchAnthropicModels(apiKey: string, base: string): Promise<CatalogModel[]> {
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  const all: CatalogModel[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const query = `limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
    const data = (await readJson(`${stripSlash(base)}/v1/models?${query}`, { headers })) as {
      data?: unknown;
      has_more?: boolean;
      last_id?: string;
    };
    const parsed = parseAnthropicModels(data);
    all.push(...parsed);
    if (!data.has_more || !data.last_id || !parsed.length) break;
    after = data.last_id;
  }
  return all;
}

async function fetchGoogleModels(apiKey: string, base: string): Promise<CatalogModel[]> {
  const data = await readJson(
    `${stripSlash(base)}/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    {},
  );
  return parseGoogleModels(data);
}

async function fetchOllamaModels(base: string): Promise<CatalogModel[]> {
  const clean = stripSlash(base.replace(/\/v1\/?$/, ''));
  const data = await readJson(`${clean}/api/tags`, {});
  return parseOllamaModels(data);
}

/**
 * 拉取指定服务商的在线模型列表。
 * - OpenAI 兼容系（OpenAI/DeepSeek/Moonshot/智谱/百炼/方舟/xAI/硅基流动/自定义）：GET {base}/models
 * - Anthropic：GET /v1/models（自动翻页）
 * - Google：GET /v1beta/models?key=
 * - Ollama：GET /api/tags（无需密钥）
 * 结果在后台内存中缓存 5 分钟，force 可跳过缓存。
 */
export async function fetchProviderModels(
  provider: ProviderId,
  options: FetchModelsOptions = {},
): Promise<CatalogModel[]> {
  const preset = PROVIDER_PRESETS[provider];
  const baseURL = (options.baseURL ?? '').trim() || preset.baseURL || '';
  if (!baseURL) {
    throw new Error(`请先填写 ${preset.label} 的 Base URL`);
  }
  if (!options.force) {
    const hit = cache.get(cacheKey(provider, baseURL));
    if (hit && Date.now() - hit.at < MODEL_LIST_TTL_MS) return hit.models;
  }

  let models: CatalogModel[];
  switch (provider) {
    case 'anthropic':
      models = await fetchAnthropicModels(requireApiKey(provider, options.apiKey), baseURL);
      break;
    case 'google':
      models = await fetchGoogleModels(requireApiKey(provider, options.apiKey), baseURL);
      break;
    case 'ollama':
      models = await fetchOllamaModels(baseURL);
      break;
    default:
      models = await fetchOpenAICompatModels(provider, options.apiKey, baseURL);
      break;
  }

  cache.set(cacheKey(provider, baseURL), { models, at: Date.now() });
  return models;
}
