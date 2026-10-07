import type { MemorySettings } from '@/shared/contracts/settings';

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

type RerankResponse = {
  results?: Array<{ index?: number; relevance_score?: number; score?: number }>;
  data?: {
    results?: Array<{ index?: number; relevance_score?: number; score?: number }>;
  };
};

async function postJson<T>(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (!apiKey.trim()) throw new Error('请先在设置中配置 Memory API Key');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Memory API 请求失败（${response.status}）${detail ? `：${detail.slice(0, 300)}` : ''}`);
  }
  return (await response.json()) as T;
}

export async function embedTexts(
  settings: MemorySettings,
  apiKey: string,
  texts: string[],
  task: 'retrieval.query' | 'retrieval.passage',
): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const body: Record<string, unknown> = {
    model: settings.embeddingModel,
    input: texts,
  };
  if (settings.provider === 'jina') {
    body.task = task;
    body.normalized = true;
    body.embedding_type = 'float';
  }
  const response = await postJson<EmbeddingResponse>(settings.embeddingEndpoint, apiKey, body);
  const vectors = response.data?.map((item) => item.embedding) ?? [];
  if (vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector) || !vector.length)) {
    throw new Error('Embedding API 返回了无效向量');
  }
  return vectors.map((vector) => new Float32Array(vector!));
}

export async function rerankTexts(
  settings: MemorySettings,
  apiKey: string,
  query: string,
  documents: string[],
): Promise<Array<{ index: number; score: number }>> {
  if (!documents.length) return [];
  const response = await postJson<RerankResponse>(settings.rerankerEndpoint, apiKey, {
    model: settings.rerankerModel,
    query,
    documents,
    top_n: documents.length,
    return_documents: false,
  });
  const results = response.results ?? response.data?.results ?? [];
  return results.flatMap((item) => {
    const score = item.relevance_score ?? item.score;
    return typeof item.index === 'number' && typeof score === 'number'
      ? [{ index: item.index, score }]
      : [];
  });
}
