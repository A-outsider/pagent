import { z } from 'zod';
export const openTabsBackgroundSchema = z.object({
    urls: z.array(z.string().trim().min(1).max(8192)).min(1).max(100),
    windowId: z.number().int().positive().optional(),
    groupName: z.string().trim().min(1).max(100).optional(),
}).strict();
