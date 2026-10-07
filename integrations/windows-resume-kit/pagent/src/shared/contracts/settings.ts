export const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'moonshot',
  'zhipu',
  'qwen',
  'ark',
  'xai',
  'siliconflow',
  'ollama',
  'openai-compatible',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const API_PROTOCOLS = ['chat-completions', 'responses'] as const;

export type ApiProtocol = (typeof API_PROTOCOLS)[number];

export type ExecutionMode = 'dom' | 'cdp';

export type MemorySettings = {
  enabled: boolean;
  provider: 'jina' | 'custom';
  embeddingEndpoint: string;
  embeddingModel: string;
  rerankerEndpoint: string;
  rerankerModel: string;
};

export type ModelSettings = {
  provider: ProviderId;
  model: string;
  baseURL?: string;
  apiProtocol: ApiProtocol;
  persistKey: boolean;
};

/** 每个服务商上次使用的模型、Base URL 和协议，切换回来时恢复。 */
export type ProviderProfile = {
  model: string;
  baseURL?: string;
  apiProtocol: ApiProtocol;
};

export type ProviderPreset = {
  label: string;
  model: string;
  apiProtocol: ApiProtocol;
  baseURL?: string;
  apiKeyHint?: string;
};

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  openai: {
    label: 'OpenAI',
    model: 'gpt-4o-mini',
    apiProtocol: 'chat-completions',
    baseURL: 'https://api.openai.com/v1',
    apiKeyHint: 'sk-…',
  },
  anthropic: {
    label: 'Anthropic',
    model: 'claude-sonnet-4-6',
    apiProtocol: 'chat-completions',
    baseURL: 'https://api.anthropic.com',
    apiKeyHint: 'sk-ant-…',
  },
  google: {
    label: 'Google Gemini',
    model: 'gemini-2.5-flash',
    apiProtocol: 'chat-completions',
    baseURL: 'https://generativelanguage.googleapis.com',
    apiKeyHint: 'AIza…',
  },
  deepseek: {
    label: 'DeepSeek',
    model: 'deepseek-chat',
    apiProtocol: 'chat-completions',
    baseURL: 'https://api.deepseek.com',
    apiKeyHint: 'sk-…',
  },
  moonshot: {
    label: 'Moonshot Kimi',
    model: 'kimi-k2-0711-preview',
    apiProtocol: 'chat-completions',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyHint: 'sk-…',
  },
  zhipu: {
    label: '智谱 GLM',
    model: 'glm-4.6',
    apiProtocol: 'chat-completions',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyHint: '{id}.{secret}',
  },
  qwen: {
    label: '阿里云百炼',
    model: 'qwen-plus',
    apiProtocol: 'chat-completions',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyHint: 'sk-…',
  },
  ark: {
    label: '火山方舟',
    model: 'doubao-seed-1-6-250615',
    apiProtocol: 'chat-completions',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyHint: 'ARK…',
  },
  xai: {
    label: 'xAI Grok',
    model: 'grok-4-fast',
    apiProtocol: 'chat-completions',
    baseURL: 'https://api.x.ai/v1',
    apiKeyHint: 'xai-…',
  },
  siliconflow: {
    label: '硅基流动',
    model: 'deepseek-ai/DeepSeek-V3.2',
    apiProtocol: 'chat-completions',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyHint: 'sk-…',
  },
  ollama: {
    label: 'Ollama（本地）',
    model: 'qwen3:8b',
    apiProtocol: 'chat-completions',
    baseURL: 'http://localhost:11434/v1',
  },
  'openai-compatible': {
    label: '自定义 OpenAI 兼容',
    model: 'gpt-4o-mini',
    apiProtocol: 'chat-completions',
  },
};

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/** 使用 ChatOpenAI（OpenAI 兼容协议）的提供商：除 Anthropic / Google 原生 SDK 外都是。 */
export function providerUsesOpenAICompat(provider: ProviderId): boolean {
  return provider !== 'anthropic' && provider !== 'google';
}

export function providerSupportsResponsesApi(provider: ProviderId): boolean {
  return provider === 'openai' || provider === 'openai-compatible';
}

export type CatalogModel = {
  id: string;
  label: string;
  tag: string;
  apiProtocol: ApiProtocol;
};

export const PROVIDER_MODELS: Record<ProviderId, CatalogModel[]> = {
  openai: [
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini', tag: 'Fast', apiProtocol: 'chat-completions' },
    { id: 'gpt-4o', label: 'gpt-4o', tag: 'Flagship', apiProtocol: 'chat-completions' },
    { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', tag: 'Fast', apiProtocol: 'chat-completions' },
    { id: 'gpt-4.1', label: 'gpt-4.1', tag: 'Flagship', apiProtocol: 'chat-completions' },
    { id: 'gpt-4.1-nano', label: 'gpt-4.1-nano', tag: 'Nano', apiProtocol: 'chat-completions' },
    { id: 'gpt-5', label: 'gpt-5', tag: 'Flagship', apiProtocol: 'chat-completions' },
    { id: 'gpt-5-mini', label: 'gpt-5-mini', tag: 'Fast', apiProtocol: 'chat-completions' },
    { id: 'gpt-5-nano', label: 'gpt-5-nano', tag: 'Nano', apiProtocol: 'chat-completions' },
    { id: 'o3-mini', label: 'o3-mini', tag: 'Reasoning', apiProtocol: 'responses' },
    { id: 'o4-mini', label: 'o4-mini', tag: 'Reasoning', apiProtocol: 'responses' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', tag: 'Sonnet', apiProtocol: 'chat-completions' },
    { id: 'claude-opus-4-6', label: 'claude-opus-4-6', tag: 'Opus', apiProtocol: 'chat-completions' },
    { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5', tag: 'Haiku', apiProtocol: 'chat-completions' },
    { id: 'claude-3-7-sonnet-latest', label: 'claude-3-7-sonnet-latest', tag: 'Sonnet', apiProtocol: 'chat-completions' },
    { id: 'claude-3-5-haiku-latest', label: 'claude-3-5-haiku-latest', tag: 'Haiku', apiProtocol: 'chat-completions' },
  ],
  google: [
    { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash', tag: 'Flash', apiProtocol: 'chat-completions' },
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash', tag: 'Flash', apiProtocol: 'chat-completions' },
    { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite', tag: 'Flash-Lite', apiProtocol: 'chat-completions' },
    { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro', tag: 'Pro', apiProtocol: 'chat-completions' },
  ],
  deepseek: [
    { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', tag: 'Fast', apiProtocol: 'chat-completions' },
    { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', tag: 'Pro', apiProtocol: 'chat-completions' },
    { id: 'deepseek-chat', label: 'deepseek-chat', tag: 'Chat', apiProtocol: 'chat-completions' },
    { id: 'deepseek-reasoner', label: 'deepseek-reasoner', tag: 'Reasoning', apiProtocol: 'chat-completions' },
  ],
  moonshot: [
    { id: 'kimi-k2-0711-preview', label: 'kimi-k2-0711-preview', tag: 'K2', apiProtocol: 'chat-completions' },
    { id: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview', tag: 'K2', apiProtocol: 'chat-completions' },
    { id: 'kimi-latest', label: 'kimi-latest', tag: 'Latest', apiProtocol: 'chat-completions' },
    { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k', tag: 'v1', apiProtocol: 'chat-completions' },
    { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k', tag: 'v1', apiProtocol: 'chat-completions' },
    { id: 'moonshot-v1-128k', label: 'moonshot-v1-128k', tag: 'v1', apiProtocol: 'chat-completions' },
  ],
  zhipu: [
    { id: 'glm-4.6', label: 'glm-4.6', tag: 'GLM-4.6', apiProtocol: 'chat-completions' },
    { id: 'glm-4.5', label: 'glm-4.5', tag: 'GLM-4.5', apiProtocol: 'chat-completions' },
    { id: 'glm-4.5-air', label: 'glm-4.5-air', tag: 'Air', apiProtocol: 'chat-completions' },
    { id: 'glm-4.5-airx', label: 'glm-4.5-airx', tag: 'AirX', apiProtocol: 'chat-completions' },
    { id: 'glm-4-plus', label: 'glm-4-plus', tag: 'Plus', apiProtocol: 'chat-completions' },
    { id: 'glm-4-air', label: 'glm-4-air', tag: 'Air', apiProtocol: 'chat-completions' },
    { id: 'glm-4-flash', label: 'glm-4-flash', tag: 'Flash', apiProtocol: 'chat-completions' },
  ],
  qwen: [
    { id: 'qwen-max', label: 'qwen-max', tag: 'Max', apiProtocol: 'chat-completions' },
    { id: 'qwen-plus', label: 'qwen-plus', tag: 'Plus', apiProtocol: 'chat-completions' },
    { id: 'qwen-turbo', label: 'qwen-turbo', tag: 'Turbo', apiProtocol: 'chat-completions' },
    { id: 'qwen3-max', label: 'qwen3-max', tag: 'Max', apiProtocol: 'chat-completions' },
    { id: 'qwen3-plus', label: 'qwen3-plus', tag: 'Plus', apiProtocol: 'chat-completions' },
    { id: 'qwen3-235b-a22b-instruct', label: 'qwen3-235b-a22b-instruct', tag: '开源', apiProtocol: 'chat-completions' },
    { id: 'qwen3-32b', label: 'qwen3-32b', tag: '开源', apiProtocol: 'chat-completions' },
    { id: 'qwen3-14b', label: 'qwen3-14b', tag: '开源', apiProtocol: 'chat-completions' },
    { id: 'qwen2.5-72b-instruct', label: 'qwen2.5-72b-instruct', tag: '开源', apiProtocol: 'chat-completions' },
    { id: 'qwen-vl-max', label: 'qwen-vl-max', tag: '视觉', apiProtocol: 'chat-completions' },
    { id: 'qwen-vl-plus', label: 'qwen-vl-plus', tag: '视觉', apiProtocol: 'chat-completions' },
  ],
  ark: [
    { id: 'doubao-seed-1-6-250615', label: 'doubao-seed-1-6-250615', tag: 'Seed', apiProtocol: 'chat-completions' },
    { id: 'doubao-seed-1-6-200615', label: 'doubao-seed-1-6-200615', tag: 'Seed', apiProtocol: 'chat-completions' },
    { id: 'doubao-1-5-pro-32k-250115', label: 'doubao-1-5-pro-32k-250115', tag: 'Pro', apiProtocol: 'chat-completions' },
    { id: 'doubao-1-5-lite-32k-250115', label: 'doubao-1-5-lite-32k-250115', tag: 'Lite', apiProtocol: 'chat-completions' },
    { id: 'doubao-pro-32k-241215', label: 'doubao-pro-32k-241215', tag: 'Pro', apiProtocol: 'chat-completions' },
    { id: 'doubao-vision-pro-32k-241015', label: 'doubao-vision-pro-32k-241015', tag: '视觉', apiProtocol: 'chat-completions' },
  ],
  xai: [
    { id: 'grok-4', label: 'grok-4', tag: 'Grok-4', apiProtocol: 'chat-completions' },
    { id: 'grok-4-fast', label: 'grok-4-fast', tag: 'Fast', apiProtocol: 'chat-completions' },
    { id: 'grok-3', label: 'grok-3', tag: 'Grok-3', apiProtocol: 'chat-completions' },
    { id: 'grok-3-mini', label: 'grok-3-mini', tag: 'Mini', apiProtocol: 'chat-completions' },
    { id: 'grok-3-mini-fast', label: 'grok-3-mini-fast', tag: 'Mini', apiProtocol: 'chat-completions' },
  ],
  siliconflow: [
    { id: 'deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek-V3.2', tag: 'DeepSeek', apiProtocol: 'chat-completions' },
    { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3', tag: 'DeepSeek', apiProtocol: 'chat-completions' },
    { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek-R1', tag: 'DeepSeek', apiProtocol: 'chat-completions' },
    { id: 'Qwen/Qwen3-235B-A22B', label: 'Qwen3-235B-A22B', tag: 'Qwen', apiProtocol: 'chat-completions' },
    { id: 'Qwen/Qwen3-32B', label: 'Qwen3-32B', tag: 'Qwen', apiProtocol: 'chat-completions' },
    { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen2.5-72B-Instruct', tag: 'Qwen', apiProtocol: 'chat-completions' },
    { id: 'THUDM/GLM-4.5-Air', label: 'GLM-4.5-Air', tag: 'GLM', apiProtocol: 'chat-completions' },
    { id: '01-ai/Yi-1.5-34B-Chat', label: 'Yi-1.5-34B-Chat', tag: 'Yi', apiProtocol: 'chat-completions' },
  ],
  ollama: [
    { id: 'qwen3:8b', label: 'qwen3:8b', tag: '本地', apiProtocol: 'chat-completions' },
    { id: 'llama3.1:8b', label: 'llama3.1:8b', tag: '本地', apiProtocol: 'chat-completions' },
    { id: 'deepseek-r1:7b', label: 'deepseek-r1:7b', tag: '本地', apiProtocol: 'chat-completions' },
    { id: 'gemma3:12b', label: 'gemma3:12b', tag: '本地', apiProtocol: 'chat-completions' },
    { id: 'mistral:7b', label: 'mistral:7b', tag: '本地', apiProtocol: 'chat-completions' },
    { id: 'phi4:14b', label: 'phi4:14b', tag: '本地', apiProtocol: 'chat-completions' },
  ],
  'openai-compatible': [
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini', tag: 'Compat', apiProtocol: 'chat-completions' },
  ],
};

export function modelsForProvider(provider: ProviderId): CatalogModel[] {
  return PROVIDER_MODELS[provider];
}

export function resolveCatalogModel(provider: ProviderId, model: string): CatalogModel {
  return (
    PROVIDER_MODELS[provider].find((item) => item.id === model) ?? {
      id: model,
      label: model,
      tag: PROVIDER_PRESETS[provider].label,
      apiProtocol: PROVIDER_PRESETS[provider].apiProtocol,
    }
  );
}

/**
 * 解析最终展示的模型列表：在线拉取成功（非空）时完全替换内置目录；
 * 未获取到在线列表（无密钥、拉取失败或为空）时才回退内置目录。
 */
export function resolveModelList(base: CatalogModel[], remote?: CatalogModel[]): CatalogModel[] {
  if (remote && remote.length > 0) return remote;
  return base;
}

export type AgentSettings = {
  model: ModelSettings;
  /** 按服务商记住上次的模型 / URL / 协议，切换回来时恢复而不是回到预设。 */
  providerProfiles: Partial<Record<ProviderId, ProviderProfile>>;
  memory: MemorySettings;
  executionMode: ExecutionMode;
  allowCrossOrigin: boolean;
  captureScreenshots: boolean;
  /** 截图以真实图片（image_url 内容块）传给模型，而不是 base64 文本；需要模型支持视觉 */
  screenshotAsImage: boolean;
  captureDevtools: boolean;
  disabledBuiltinTools: string[];
  theme: 'light' | 'dark' | 'system';
};

export type AgentSettingsPatch = Partial<Omit<AgentSettings, 'model' | 'memory' | 'providerProfiles'>> & {
  model?: Partial<ModelSettings>;
  memory?: Partial<MemorySettings>;
  providerProfiles?: AgentSettings['providerProfiles'];
};

export function snapshotProviderProfile(model: ModelSettings): ProviderProfile {
  const profile: ProviderProfile = {
    model: model.model,
    apiProtocol: model.apiProtocol,
  };
  if (model.baseURL !== undefined) profile.baseURL = model.baseURL;
  return profile;
}

export function modelSettingsForProvider(
  provider: ProviderId,
  profiles: Partial<Record<ProviderId, ProviderProfile>> | undefined,
  persistKey: boolean,
): ModelSettings {
  const preset = PROVIDER_PRESETS[provider];
  const saved = profiles?.[provider];
  const next: ModelSettings = {
    provider,
    persistKey,
    model: saved?.model ?? preset.model,
    apiProtocol: saved?.apiProtocol ?? preset.apiProtocol,
  };
  if (saved?.baseURL !== undefined) next.baseURL = saved.baseURL;
  return next;
}

function mergeModelSettings(base: ModelSettings, patch?: Partial<ModelSettings>): ModelSettings {
  if (!patch) return { ...base };
  const next = { ...base, ...patch };
  if ('baseURL' in patch && patch.baseURL === undefined) {
    delete next.baseURL;
  }
  return next;
}

/** 合并设置补丁：切换服务商时先归档当前项，再恢复目标服务商上次的模型 / URL / 协议。 */
export function applySettingsPatch(current: AgentSettings, patch: AgentSettingsPatch): AgentSettings {
  const profiles: Partial<Record<ProviderId, ProviderProfile>> =
    patch.providerProfiles !== undefined
      ? { ...patch.providerProfiles }
      : {
          ...current.providerProfiles,
          [current.model.provider]: snapshotProviderProfile(current.model),
        };

  const persistKey = patch.model?.persistKey ?? current.model.persistKey;
  let model: ModelSettings;
  if (patch.model?.provider && patch.model.provider !== current.model.provider) {
    model = mergeModelSettings(
      modelSettingsForProvider(patch.model.provider, profiles, persistKey),
      patch.model,
    );
  } else {
    model = mergeModelSettings(current.model, patch.model);
  }

  if (model.provider === 'deepseek' && model.apiProtocol === 'responses') {
    model = { ...model, apiProtocol: 'chat-completions' };
  }
  profiles[model.provider] = snapshotProviderProfile(model);

  return {
    ...current,
    ...patch,
    model,
    memory: { ...current.memory, ...patch.memory },
    providerProfiles: profiles,
  };
}

export type SecretMap = Partial<Record<ProviderId, string>>;

export type PermissionState = {
  allSites: boolean;
  debugger: boolean;
  tabs: boolean;
  origins: string[];
};

export const DEFAULT_SETTINGS: AgentSettings = {
  model: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiProtocol: 'chat-completions',
    persistKey: true,
  },
  providerProfiles: {},
  memory: {
    enabled: true,
    provider: 'jina',
    embeddingEndpoint: 'https://api.jina.ai/v1/embeddings',
    embeddingModel: 'jina-embeddings-v5-text-small',
    rerankerEndpoint: 'https://api.jina.ai/v1/rerank',
    rerankerModel: 'jina-reranker-v3.5',
  },
  executionMode: 'dom',
  allowCrossOrigin: false,
  captureScreenshots: true,
  screenshotAsImage: true,
  captureDevtools: true,
  disabledBuiltinTools: [],
  theme: 'system',
};
