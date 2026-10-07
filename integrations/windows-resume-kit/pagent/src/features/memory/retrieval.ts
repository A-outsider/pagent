import { embedTexts, rerankTexts } from './api';
import { listMemoriesForDomain, putMemories } from './storage';
import { memoryView, type MemoryRecord, type MemorySearchResult } from '@/shared/contracts/memory';
import type { MemorySettings } from '@/shared/contracts/settings';

const DEFAULT_LIMIT = 8;
const RERANK_CANDIDATES = 24;
const MIN_RERANK_SCORE = 0.2;

function memorySearchView(
  record: MemoryRecord,
): Omit<ReturnType<typeof memoryView>, 'createdAt' | 'updatedAt'> {
  const { createdAt: _, updatedAt: __, ...view } = memoryView(record);
  return view;
}

export function embeddingFingerprint(settings: MemorySettings): string {
  return `${settings.provider}:${settings.embeddingEndpoint}:${settings.embeddingModel}`;
}

export function vectorBuffer(vector: Float32Array): ArrayBuffer {
  return vector.buffer.slice(
    vector.byteOffset,
    vector.byteOffset + vector.byteLength,
  ) as ArrayBuffer;
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (!left.length || left.length !== right.length) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : -1;
}

async function refreshStaleEmbeddings(
  records: MemoryRecord[],
  settings: MemorySettings,
  apiKey: string,
): Promise<MemoryRecord[]> {
  const fingerprint = embeddingFingerprint(settings);
  const stale = records.filter(
    (record) => record.embeddingModel !== fingerprint || record.embedding.byteLength === 0,
  );
  if (!stale.length) return records;
  const vectors = await embedTexts(
    settings,
    apiKey,
    stale.map((record) => record.content),
    'retrieval.passage',
  );
  const replacements = stale.map((record, index) => ({
    ...record,
    embedding: vectorBuffer(vectors[index]!),
    embeddingModel: fingerprint,
  }));
  await putMemories(replacements);
  const byId = new Map(replacements.map((record) => [record.id, record]));
  return records.map((record) => byId.get(record.id) ?? record);
}

export async function searchMemories(options: {
  query: string;
  domain?: string | null;
  settings: MemorySettings;
  apiKey: string;
  limit?: number;
}): Promise<MemorySearchResult[]> {
  const query = options.query.trim();
  if (!query || !options.settings.enabled) return [];
  let records = await listMemoriesForDomain(options.domain);
  if (!records.length) return [];
  records = await refreshStaleEmbeddings(records, options.settings, options.apiKey);
  const [queryVector] = await embedTexts(options.settings, options.apiKey, [query], 'retrieval.query');
  const candidates = records
    .map((record) => ({
      record,
      vectorScore: cosineSimilarity(queryVector!, new Float32Array(record.embedding)),
    }))
    .sort((a, b) => b.vectorScore - a.vectorScore)
    .slice(0, RERANK_CANDIDATES);
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, candidates.length);

  try {
    const ranked = await rerankTexts(
      options.settings,
      options.apiKey,
      query,
      candidates.map((item) => item.record.content),
    );
    if (!ranked.length) throw new Error('Reranker 未返回排序结果');
    return ranked
      .filter((item) => Number.isFinite(item.score) && item.score >= MIN_RERANK_SCORE)
      .slice(0, limit)
      .flatMap((item) => {
        const candidate = candidates[item.index];
        return candidate
          ? [{
              ...memorySearchView(candidate.record),
              score: item.score,
              vectorScore: candidate.vectorScore,
            }]
          : [];
      });
  } catch {
    return candidates.slice(0, limit).map((candidate) => ({
      ...memorySearchView(candidate.record),
      score: candidate.vectorScore,
      vectorScore: candidate.vectorScore,
    }));
  }
}
