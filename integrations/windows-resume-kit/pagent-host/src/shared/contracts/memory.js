import { z } from 'zod';
export const MEMORY_SCOPES = ['global', 'local'];
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
export function memoryView(record) {
    const { embedding: _, ...view } = record;
    return view;
}
