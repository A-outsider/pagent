import { z } from 'zod';

export const MEMORY_SCOPES = ['global', 'local'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export type MemoryRecord = {
  id: string;
  content: string;
  scope: MemoryScope;
  domain?: string;
  sourceUrl?: string;
  embedding: ArrayBuffer;
  embeddingModel: string;
  createdAt: number;
  updatedAt: number;
};

export type MemoryView = Omit<MemoryRecord, 'embedding'>;

export type MemorySearchResult = Omit<MemoryView, 'createdAt' | 'updatedAt'> & {
  score: number;
  vectorScore: number;
};

export const memoryListPayloadSchema = z.object({});

export const memorySearchPayloadSchema = z.object({
  query: z.string().trim().min(1).max(4000),
  limit: z.number().int().min(1).max(20).optional(),
});

export const memoryWritePayloadSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  scope: z.enum(MEMORY_SCOPES),
  memoryId: z.string().min(1).optional(),
});

export const memoryUpdatePayloadSchema = z.object({
  id: z.string().min(1),
  content: z.string().trim().min(1).max(8000),
});

export const memoryDeletePayloadSchema = z.object({
  id: z.string().min(1),
});

export function memoryView(record: MemoryRecord): MemoryView {
  const { embedding: _, ...view } = record;
  return view;
}
