import { z } from 'zod';
import { API_PROTOCOLS, PROVIDER_IDS } from './settings';
import { ELEMENT_ACTIONS, NAMED_SCRIPTS, SOURCE_TYPES } from './page';
import { mcpConfigSchema } from './mcp';
import { CHANNEL } from './channel';
import { uploadAttachmentSchema } from './attachments';
import { prepareResumeFormSchema, resumeUploadWatchSchema } from './resume-form';
import { bossCancelTaskSchema, bossGetTaskSchema } from './boss-task';
import { bossGetFavoritesTaskSchema, bossCancelFavoritesTaskSchema, bossStartFavoritesInputSchema, bossFavoritesPreferencesSchema } from './boss-favorites';
import {
  memoryDeletePayloadSchema,
  memoryListPayloadSchema,
  memoryUpdatePayloadSchema,
} from './memory';

export { CHANNEL } from './channel';

export const elementRefSchema = z.object({
  elementId: z.string(),
  revision: z.number().int().nonnegative().optional(),
});

export const observePayloadSchema = z.object({
  reason: z.string().optional(),
  maxElements: z.number().int().min(1).max(400).optional(),
  offset: z.number().int().nonnegative().optional(),
  scope: z.enum(['auto', 'page', 'interaction']).optional(),
});

export const changeSnapshotSchema = z.object({
  watchId: z.string(),
  documentId: z.string(),
  cursor: z.number().int().nonnegative(),
  mutationCount: z.number().int().nonnegative(),
  maxNodes: z.number().int().min(10).max(400),
  url: z.string(),
  title: z.string(),
  viewport: z.object({
    scrollX: z.number(),
    scrollY: z.number(),
  }),
  nodes: z.array(z.object({
    id: z.string(),
    tag: z.string(),
    role: z.string(),
    name: z.string(),
    value: z.string().optional(),
    href: z.string().optional(),
    visible: z.boolean(),
    disabled: z.boolean().optional(),
    checked: z.boolean().optional(),
    selected: z.boolean().optional(),
    expanded: z.boolean().optional(),
  })).max(400),
});

export const searchPayloadSchema = z.object({
  query: z.string().min(1).max(200),
  caseSensitive: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(80).optional(),
  scope: z.enum(['auto', 'page', 'interaction']).optional(),
});

export const typePayloadSchema = elementRefSchema.extend({
  text: z.string(),
  mode: z.enum(['replace', 'append']).optional(),
  clear: z.boolean().optional(),
  submit: z.boolean().optional(),
});

export const interactionStepSchema = elementRefSchema.extend({
  intent: z.enum(ELEMENT_ACTIONS),
  value: z.union([z.string(), z.boolean(), z.number()]).optional(),
});

export const verifyFieldsPayloadSchema = z.object({
  fields: z.array(z.discriminatedUnion('intent', [
    elementRefSchema.extend({ intent: z.literal('set-value'), value: z.union([z.string(), z.number()]) }),
    elementRefSchema.extend({ intent: z.literal('choose-option'), value: z.union([z.string(), z.number()]) }),
    elementRefSchema.extend({ intent: z.literal('set-checked'), value: z.boolean() }),
  ])).min(1).max(30),
});

export const keyPayloadSchema = z.object({
  key: z.string().min(1),
  revision: z.number().int().nonnegative().optional(),
});

export const scrollPayloadSchema = z.object({
  elementId: z.string().optional(),
  direction: z.enum(['up', 'down', 'left', 'right', 'top', 'bottom']).optional(),
  amount: z.number().optional(),
  revision: z.number().int().nonnegative().optional(),
});

export const waitPayloadSchema = z.object({
  ms: z.number().int().min(0).max(30_000).optional(),
  text: z.string().optional(),
  elementId: z.string().optional(),
  urlIncludes: z.string().optional(),
});

export const namedScriptPayloadSchema = z.object({
  name: z.enum(NAMED_SCRIPTS),
  scope: z.enum(['auto', 'page', 'interaction']).optional(),
  maxElements: z.number().int().min(1).max(400).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export const elementTreePayloadSchema = elementRefSchema.extend({
  fields: z.object({
    text: z.boolean().optional(),
    coordinates: z.boolean().optional(),
    attributes: z.array(
      z.string().regex(/^[A-Za-z_:][A-Za-z0-9:._-]*$/),
    ).max(20).optional(),
  }).optional(),
  maxDepth: z.number().int().min(0).max(20).optional(),
  maxLength: z.number().int().min(2).max(2_000).optional(),
});

export const commonAncestorPayloadSchema = z.object({
  elementIds: z.array(z.string()).min(2).max(20),
  revision: z.number().int().nonnegative().optional(),
});

export const sourcePayloadSchema = z.object({
  type: z.enum(SOURCE_TYPES).optional(),
  grep: z.string().min(1).max(300).optional(),
  regex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  limit: z.number().int().min(1).max(400).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
});

export const navigatePayloadSchema = z.object({
  url: z.string().min(1),
});

export const tabPayloadSchema = z.object({
  tabId: z.number().int().optional(),
  url: z.string().optional(),
});

export const cdpScriptPayloadSchema = z.object({
  expression: z.string().min(1).max(20_000),
  awaitPromise: z.boolean().optional(),
});

export const cdpInputPayloadSchema = z.object({
  x: z.number(),
  y: z.number(),
  type: z.enum(['click', 'move', 'down', 'up']).default('click'),
  button: z.enum(['left', 'right', 'middle']).optional(),
  text: z.string().optional(),
});

export const networkLogPayloadSchema = z.object({
  urlIncludes: z.string().optional(),
  method: z.string().optional(),
  resourceType: z.string().optional(),
  failedOnly: z.boolean().optional(),
  includeNoise: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const consoleLogPayloadSchema = z.object({
  level: z.string().optional(),
  textIncludes: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const networkRequestPayloadSchema = z.object({
  requestId: z.string().min(1),
  includeBody: z.boolean().optional(),
});

export const llmTestPayloadSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string(),
  baseURL: z.string().optional(),
  apiProtocol: z.enum(API_PROTOCOLS).optional(),
});

export const modelsListPayloadSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  baseURL: z.string().optional(),
  force: z.boolean().optional(),
});

export const userBadgeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tab'),
    id: z.number().int(),
    title: z.string(),
  }),
  z.object({
    type: z.literal('command'),
    key: z.string(),
    name: z.string(),
  }),
  z.object({
    type: z.literal('element'),
    name: z.string().optional(),
    tag: z.string().optional(),
  }),
]);

export const userReferenceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('page'),
    tabId: z.number().int(),
    title: z.string(),
    url: z.string(),
    active: z.boolean().optional(),
    content: z.string().optional(),
    truncated: z.boolean().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('command'),
    key: z.string(),
    name: z.string(),
    desc: z.string().optional(),
    prompt: z.string(),
  }),
  z.object({
    type: z.literal('element'),
    name: z.string().optional(),
    tag: z.string().optional(),
    element: z.unknown().optional(),
  }),
]);

export const rpcSchemas = {
  'dom.observe': observePayloadSchema,
  'dom.changes.start': z.object({
    maxNodes: z.number().int().min(10).max(400).optional(),
  }),
  'dom.changes.read': z.object({
    baseline: changeSnapshotSchema,
    timeoutMs: z.number().int().min(0).max(10_000).optional(),
    quietMs: z.number().int().min(50).max(2_000).optional(),
    maxChanges: z.number().int().min(1).max(100).optional(),
  }),
  'dom.search': searchPayloadSchema,
  'dom.click': elementRefSchema,
  'dom.dblclick': elementRefSchema,
  'dom.hover': elementRefSchema,
  'dom.focus': elementRefSchema,
  'dom.type': typePayloadSchema,
  'attachments.upload': uploadAttachmentSchema,
  'dom.resume.begin': prepareResumeFormSchema,
  'dom.resume.wait': resumeUploadWatchSchema,
  'dom.resume.scan': z.object({}),
  'boss.task.get': bossGetTaskSchema,
  'boss.task.cancel': bossCancelTaskSchema,
  'boss.favorites.start': bossStartFavoritesInputSchema,
  'boss.favorites.get': bossGetFavoritesTaskSchema,
  'boss.favorites.cancel': bossCancelFavoritesTaskSchema,
  'boss.favorites.preferences.get': z.object({}).strict(),
  'boss.favorites.preferences.set': bossFavoritesPreferencesSchema,
  'dom.clear': elementRefSchema,
  'dom.select': elementRefSchema.extend({ value: z.string() }),
  'dom.interact': z.object({
    steps: z.array(interactionStepSchema).min(1).max(30),
  }),
  'dom.verifyFields': verifyFieldsPayloadSchema,
  'dom.drag': elementRefSchema.extend({ targetId: z.string() }),
  'dom.press': keyPayloadSchema,
  'dom.scroll': scrollPayloadSchema,
  'dom.wait': waitPayloadSchema,
  'dom.script': namedScriptPayloadSchema,
  'dom.elementTree': elementTreePayloadSchema,
  'dom.commonAncestor': commonAncestorPayloadSchema,
  'page.info': z.object({}),
  'page.source': sourcePayloadSchema,
  'page.navigate': navigatePayloadSchema,
  'page.back': z.object({}),
  'page.forward': z.object({}),
  'page.reload': z.object({}),
  'tabs.query': z.object({}),
  'tabs.snapshot': z.object({
    tabIds: z.array(z.number().int()).min(1).max(8),
  }),
  'tabs.create': z.object({ url: z.string().optional() }),
  'tabs.switch': tabPayloadSchema,
  'tabs.close': tabPayloadSchema,
  'screenshot.capture': z.object({
    fullPage: z.boolean().optional(),
    raw: z.boolean().optional(),
  }),
  'permissions.get': z.object({}),
  'permissions.request': z.object({
    allSites: z.boolean().optional(),
    debugger: z.boolean().optional(),
    tabs: z.boolean().optional(),
    origins: z.array(z.string()).optional(),
  }),
  'cdp.attach': z.object({}),
  'cdp.detach': z.object({}),
  'cdp.script': cdpScriptPayloadSchema,
  'cdp.input': cdpInputPayloadSchema,
  'cdp.network': networkLogPayloadSchema,
  'cdp.console': consoleLogPayloadSchema,
  'cdp.networkRequest': networkRequestPayloadSchema,
  'settings.get': z.object({}),
  'settings.set': z.object({}).passthrough(),
  'mcp.getState': z.object({}),
  'mcp.setConfig': z.object({
    config: mcpConfigSchema,
  }),
  'mcp.sync': z.object({}),
  'secrets.set': z.object({
    provider: z.enum(PROVIDER_IDS),
    apiKey: z.string(),
  }),
  'secrets.clear': z.object({
    provider: z.enum(PROVIDER_IDS).optional(),
  }),
  'secrets.has': z.object({}),
  'models.list': modelsListPayloadSchema,
  'llm.test': llmTestPayloadSchema,
  'memory.list': memoryListPayloadSchema,
  'memory.update': memoryUpdatePayloadSchema,
  'memory.delete': memoryDeletePayloadSchema,
  'memory.secret.set': z.object({ apiKey: z.string().min(1) }),
  'memory.secret.clear': z.object({}),
  'memory.secret.has': z.object({}),
  'memory.test': z.object({}),
  'agent.start': z.object({
    prompt: z.string().min(1),
    context: z.string().optional(),
    imageDataUrl: z.string().startsWith('data:image/').optional(),
    badges: z.array(userBadgeSchema).optional(),
    references: z.array(userReferenceSchema).optional(),
    tabId: z.number().int().optional(),
    conversationId: z.string().optional(),
    history: z.array(z.any()).optional(),
  }),
  'agent.stop': z.object({
    tabId: z.number().int().optional(),
  }),
  'agent.toggle': z.object({}),
  'menu.getState': z.object({}),
  'menu.openCurrent': z.object({}),
  'menu.hideCurrent': z.object({}),
  'menu.setPermanentlyHidden': z.object({
    hidden: z.boolean(),
  }),
  'session.context': z.object({
    url: z.string().optional(),
  }),
  'session.setUi': z.object({
    panelOpen: z.boolean(),
  }),
  'session.saveStore': z.object({
    activeId: z.string(),
    conversations: z.array(z.any()),
    panelOpen: z.boolean().optional(),
    sessionId: z.string().optional(),
    revision: z.number().int().nonnegative().optional(),
    deletedConversationIds: z.array(z.string()).optional(),
    url: z.string().optional(),
  }),
  'conversations.list': z.object({}),
  'conversations.get': z.object({
    ids: z.array(z.string().min(1)).min(1).max(200),
    includeImages: z.boolean().optional(),
  }),
  'teaching.start': z.object({
    url: z.string().url(),
    conversationId: z.string().optional(),
  }),
  'teaching.context': z.object({}),
  'teaching.append': z.object({
    actions: z.array(z.any()).max(100),
  }),
  'teaching.finish': z.object({}),
  'teaching.cancel': z.object({}),
  'teaching.revise': z.object({
    request: z.string().min(1).max(4000),
  }),
  'teaching.confirm': z.object({}),
  'commands.list': z.object({
    url: z.string().optional(),
  }),
} as const;

export type RpcName = keyof typeof rpcSchemas;

export type RpcRequest<K extends RpcName = RpcName> = {
  channel: typeof CHANNEL;
  kind: 'rpc';
  id: string;
  name: K;
  payload: z.infer<(typeof rpcSchemas)[K]>;
};

export type RpcResponse = {
  channel: typeof CHANNEL;
  kind: 'rpc-result';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

export function parseRpcPayload<K extends RpcName>(
  name: K,
  payload: unknown,
): z.infer<(typeof rpcSchemas)[K]> {
  return rpcSchemas[name].parse(payload) as z.infer<(typeof rpcSchemas)[K]>;
}

export function isRpcRequest(value: unknown): value is RpcRequest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.channel === CHANNEL && item.kind === 'rpc' && typeof item.name === 'string';
}
