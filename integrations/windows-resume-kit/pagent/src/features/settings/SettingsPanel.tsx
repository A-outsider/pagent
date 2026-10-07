import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconLoader2, IconRefresh } from '@tabler/icons-react';
import { AnimatedBadge, type AnimatedBadgeStatus } from '@/shared/ui/beui/animated-badge';
import { BouncyAccordion } from '@/shared/ui/beui/bouncy-accordion';
import { Button } from '@/shared/ui/beui/button';
import { Input } from '@/shared/ui/beui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/beui/select';
import { Switch } from '@/shared/ui/beui/switch';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';
import { rpc } from '@/shared/extension/rpc-client';
import { requestPermissions } from '@/shared/browser/permissions';
import { mcpConfigSchema, type McpState, type McpServerStatusKind } from '@/shared/contracts/mcp';
import { BUILTIN_TOOL_DISPLAY } from '@/features/agent/session/tool-display';
import {
  DEFAULT_SETTINGS,
  PROVIDER_IDS,
  PROVIDER_PRESETS,
  resolveModelList,
  modelsForProvider,
  providerUsesOpenAICompat,
  resolveCatalogModel,
  providerSupportsResponsesApi,
  type AgentSettings,
  type AgentSettingsPatch,
  type ApiProtocol,
  type CatalogModel,
  type PermissionState,
  type ProviderId,
} from '@/shared/contracts/settings';
import { MemorySettingsSection } from './MemorySettingsSection';
import { openDetailedSettings } from './open-options';

async function requestOptionalPermissions(options: {
  debugger?: boolean;
  tabs?: boolean;
  allSites?: boolean;
}): Promise<PermissionState> {
  try {
    return await requestPermissions(options);
  } catch {
    return (await rpc('permissions.request', options)) as PermissionState;
  }
}

const MCP_STATUS_LABELS: Record<McpServerStatusKind, string> = {
  connected: '已连接',
  connecting: '连接中…',
  unauthorized: '未授权',
  error: '连接失败',
  disabled: '已禁用',
  disconnected: '未连接',
};

const MCP_BADGE_STATUS: Record<McpServerStatusKind, AnimatedBadgeStatus> = {
  connected: 'success',
  connecting: 'loading',
  unauthorized: 'warning',
  error: 'danger',
  disabled: 'neutral',
  disconnected: 'neutral',
};

function SettingRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="min-w-0 flex-1 leading-5 text-ink-2">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  variant = 'panel',
}: {
  settings: AgentSettings;
  onChange: (settings: AgentSettings) => void;
  variant?: 'panel' | 'page';
}) {
  const [key, setKey] = useState('');
  const [modelId, setModelId] = useState(settings.model.model);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [permissions, setPermissions] = useState<PermissionState>();
  const [status, setStatus] = useState('');
  const [mcpJson, setMcpJson] = useState('');
  const [mcpState, setMcpState] = useState<McpState>();
  const [mcpError, setMcpError] = useState('');
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpToolsOpen, setMcpToolsOpen] = useState(false);
  const [remoteModels, setRemoteModels] = useState<Partial<Record<ProviderId, CatalogModel[]>>>({});
  const [fetchingModels, setFetchingModels] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const mcpJsonReady = useRef(false);
  const fetchSeq = useRef(0);

  const refresh = async () => {
    const [has, perms, mcp] = await Promise.all([
      rpc('secrets.has', {}) as Promise<Record<string, boolean>>,
      rpc('permissions.get', {}) as Promise<PermissionState>,
      rpc('mcp.getState', {}) as Promise<McpState>,
    ]);
    setKeys(has);
    setPermissions(perms);
    setMcpState(mcp);
    if (!mcpJsonReady.current) {
      mcpJsonReady.current = true;
      setMcpJson(JSON.stringify(mcp.config, null, 2));
    }
  };

  const saveMcp = async () => {
    setMcpBusy(true);
    setMcpError('');
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(mcpJson);
      } catch {
        throw new Error('MCP 配置不是合法的 JSON');
      }
      const entries = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).mcpServers : undefined;
      if (!entries || typeof entries !== 'object') {
        throw new Error('配置缺少 mcpServers 对象，请使用 mcp-server.json 格式');
      }
      for (const [name, value] of Object.entries(entries as Record<string, unknown>)) {
        const server = value as Record<string, unknown> | null;
        if (!server || typeof server !== 'object') {
          throw new Error(`服务器「${name}」配置不是对象`);
        }
        if (typeof server.command === 'string' && !server.url) {
          throw new Error(`服务器「${name}」使用 stdio(command) 启动，浏览器扩展仅支持远程 http/ws 服务器`);
        }
      }
      const parsed = mcpConfigSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(`配置格式错误：${issue?.path.join('.') || 'mcpServers'} ${issue?.message ?? ''}`);
      }
      const state = (await rpc('mcp.setConfig', { config: parsed.data })) as McpState;
      setMcpState(state);
      setStatus('MCP 配置已保存并尝试连接');
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMcpBusy(false);
    }
  };

  const setMcpToolEnabled = async (serverName: string, toolName: string, enabled: boolean) => {
    if (!mcpState) return;
    const server = mcpState.config.mcpServers[serverName];
    if (!server) return;
    const disabledTools = new Set(server.disabledTools ?? []);
    if (enabled) disabledTools.delete(toolName);
    else disabledTools.add(toolName);
    const config = {
      ...mcpState.config,
      mcpServers: {
        ...mcpState.config.mcpServers,
        [serverName]: {
          ...server,
          disabledTools: [...disabledTools],
        },
      },
    };
    setMcpBusy(true);
    setMcpError('');
    try {
      const state = (await rpc('mcp.setConfig', { config })) as McpState;
      setMcpState(state);
      setMcpJson(JSON.stringify(state.config, null, 2));
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
    } finally {
      setMcpBusy(false);
    }
  };

  const setBuiltinToolEnabled = (toolName: string, enabled: boolean) => {
    const disabledTools = new Set(settings.disabledBuiltinTools ?? []);
    if (enabled) disabledTools.delete(toolName);
    else disabledTools.add(toolName);
    void patch({ disabledBuiltinTools: [...disabledTools] });
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setModelId(settings.model.model);
  }, [settings.model.provider, settings.model.model]);

  useLayoutEffect(() => {
    const scrollContainer = panelRef.current?.parentElement;
    if (scrollContainer) scrollContainer.scrollTop = 0;
  }, []);

  const patch = async (next: AgentSettingsPatch) => {
    const saved = (await rpc('settings.set', next)) as AgentSettings;
    onChange(saved);
  };

  const refreshModels = useCallback(
    async (provider: ProviderId, options?: { force?: boolean }) => {
      const seq = ++fetchSeq.current;
      setFetchingModels(true);
      try {
        const models = (await rpc('models.list', {
          provider,
          baseURL: settings.model.baseURL,
          force: options?.force,
        })) as CatalogModel[];
        if (seq !== fetchSeq.current) return;
        setRemoteModels((prev) => ({ ...prev, [provider]: models }));
      } catch (error) {
        if (seq !== fetchSeq.current) return;
        setRemoteModels((prev) => ({ ...prev, [provider]: undefined }));
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        if (seq === fetchSeq.current) setFetchingModels(false);
      }
    },
    [settings.model.baseURL],
  );

  // 已保存密钥的服务商自动拉取在线模型列表（防抖，避免输入 Base URL 时频繁请求）
  useEffect(() => {
    const provider = settings.model.provider;
    if (!keys[provider]) return;
    const timer = setTimeout(() => {
      void refreshModels(provider);
    }, 250);
    return () => clearTimeout(timer);
  }, [settings.model.provider, keys[settings.model.provider], settings.model.baseURL, refreshModels]);

  const provider = settings.model.provider;
  const preset = PROVIDER_PRESETS[provider];
  const catalog = modelsForProvider(provider);
  const remote = remoteModels[provider];
  const mergedModels = resolveModelList(catalog, remote);

  return (
    <div ref={panelRef} className="space-y-3 text-sm text-ink">
      <section className="space-y-2.5 rounded-card border border-line bg-surface p-3">
        <h3 className="text-xs font-semibold tracking-wide text-ink-2">模型</h3>
        <div className="space-y-1.5">
          <Label htmlFor="provider">服务商</Label>
          <Select
            value={provider}
            onValueChange={(provider) => {
              void patch({ model: { provider: provider as ProviderId } });
            }}
          >
            <SelectTrigger id="provider" aria-label="服务商" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {PROVIDER_PRESETS[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative space-y-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="absolute -top-1 right-0 h-6 gap-1 px-1.5 text-[11.5px] text-ink-2"
            disabled={fetchingModels}
            onClick={() => void refreshModels(provider, { force: true })}
          >
            {fetchingModels ? (
              <IconLoader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <IconRefresh aria-hidden className="size-3.5" />
            )}
            {fetchingModels ? '获取中…' : '刷新模型列表'}
          </Button>
          <Label htmlFor="model-name">模型</Label>
          <Select
            value={settings.model.model}
            onValueChange={(model) => {
              const next = resolveCatalogModel(provider, model);
              void patch({
                model: { ...settings.model, model: next.id, apiProtocol: next.apiProtocol },
              });
            }}
          >
            <SelectTrigger id="model-name" aria-label="模型" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mergedModels.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
              {!mergedModels.some((item) => item.id === settings.model.model) && (
                <SelectItem value={settings.model.model}>{settings.model.model}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-model-id">模型 ID（可自定义）</Label>
          <Input
            id="custom-model-id"
            value={modelId}
            onValueChange={setModelId}
            spellCheck={false}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!modelId.trim() || modelId.trim() === settings.model.model}
            onClick={async () => {
              await patch({ model: { model: modelId.trim() } });
              setStatus('模型已保存');
            }}
          >
            保存模型
          </Button>
        </div>
        {providerSupportsResponsesApi(provider) && (
          <div className="space-y-1.5">
            <Label htmlFor="api-protocol">接口协议</Label>
            <Select
              value={settings.model.apiProtocol ?? 'chat-completions'}
              onValueChange={(value) => {
                const apiProtocol = value as ApiProtocol;
                const nextModel =
                  provider === 'deepseek'
                    ? apiProtocol === 'responses'
                      ? 'deepseek-v4-flash'
                      : settings.model.model.startsWith('deepseek-v4')
                        ? 'deepseek-chat'
                        : settings.model.model
                    : settings.model.model;
                void patch({ model: { ...settings.model, apiProtocol, model: nextModel } });
              }}
            >
              <SelectTrigger id="api-protocol" aria-label="接口协议" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat-completions">Chat Completions（/chat/completions）</SelectItem>
                <SelectItem value="responses">Responses（/responses）</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {(providerUsesOpenAICompat(provider) || provider === 'anthropic') && (
          <div className="space-y-1.5">
            <Label htmlFor="base-url">Base URL</Label>
            <Input
              id="base-url"
              value={settings.model.baseURL ?? ''}
              onValueChange={(baseURL) =>
                void patch({ model: { ...settings.model, baseURL } })
              }
              placeholder={preset.baseURL ?? 'https://your-endpoint/v1'}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="api-key">API Key</Label>
          <Input
            id="api-key"
            type="password"
            value={key}
            onValueChange={setKey}
            placeholder={keys[provider] ? '已保存密钥，输入新值覆盖' : (preset.apiKeyHint ?? 'API Key')}
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={async () => {
              if (!key.trim()) return;
              await rpc('secrets.set', { provider, apiKey: key.trim() });
              setKey('');
              setStatus('密钥已保存到本地');
              await refresh();
              void refreshModels(provider, { force: true });
            }}
          >
            保存密钥
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              setStatus('正在测试连接…');
              try {
                const result = (await rpc('llm.test', {
                  provider,
                  model: settings.model.model,
                  baseURL: settings.model.baseURL,
                  apiProtocol: settings.model.apiProtocol,
                })) as { preview?: string };
                setStatus(`连接成功：${result.preview ?? 'ok'}`);
              } catch (error) {
                setStatus(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            测试连接
          </Button>
        </div>
      </section>

      <section className="space-y-2.5 rounded-card border border-line bg-surface p-3">
        <h3 className="text-xs font-semibold tracking-wide text-ink-2">执行</h3>
        <SettingRow
          label="使用 CDP 高级输入 / 整页截图"
          checked={settings.executionMode === 'cdp'}
          onCheckedChange={(enabled) => {
            const executionMode = enabled ? 'cdp' : 'dom';
            onChange({ ...settings, executionMode });
            void (async () => {
              let granted = permissions?.debugger ?? false;
              if (enabled && !granted) {
                try {
                  const state = await requestOptionalPermissions({ debugger: true });
                  setPermissions(state);
                  granted = state.debugger;
                } catch (error) {
                  setStatus(error instanceof Error ? error.message : '申请调试器权限失败');
                }
              }
              await patch({ executionMode });
              setStatus(
                enabled && !granted
                  ? '已开启 CDP。若浏览器未弹出授权，请点击下方「授予调试器权限」。'
                  : '',
              );
              await refresh();
            })();
          }}
        />
        {(settings.executionMode === 'cdp' || settings.captureDevtools) && !permissions?.debugger ? (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const state = await requestOptionalPermissions({ debugger: true });
                setPermissions(state);
                setStatus(state.debugger ? '已授予调试器权限' : '未授予调试器权限，高级输入/整页截图仍不可用');
              } catch {
                await browser.runtime.openOptionsPage();
                setStatus('请在扩展设置页授予调试器权限');
              }
              await refresh();
            }}
          >
            授予调试器权限
          </Button>
        ) : null}
        <SettingRow
          label="发送截图给模型"
          checked={settings.captureScreenshots}
          onCheckedChange={(captureScreenshots) => void patch({ captureScreenshots })}
        />
        <SettingRow
          label="截图以图片形式传给模型（需模型支持视觉）"
          checked={settings.screenshotAsImage}
          onCheckedChange={(screenshotAsImage) => void patch({ screenshotAsImage })}
        />
        <SettingRow
          label="采集网络请求和控制台日志"
          checked={settings.captureDevtools}
          onCheckedChange={(enabled) => {
            onChange({ ...settings, captureDevtools: enabled });
            void (async () => {
              if (enabled && !permissions?.debugger) {
                try {
                  const state = await requestOptionalPermissions({ debugger: true });
                  setPermissions(state);
                } catch (error) {
                  setStatus(error instanceof Error ? error.message : '申请调试器权限失败');
                }
              }
              await patch({ captureDevtools: enabled });
              await refresh();
            })();
          }}
        />
        <SettingRow
          label="允许更宽的跨站导航"
          checked={settings.allowCrossOrigin}
          onCheckedChange={(allowCrossOrigin) => void patch({ allowCrossOrigin })}
        />
      </section>

      <MemorySettingsSection settings={settings} onPatch={patch} />

      <BouncyAccordion
        value={mcpOpen ? 'mcp' : null}
        onValueChange={(value) => setMcpOpen(value === 'mcp')}
        items={[
          {
            id: 'mcp',
            title: 'MCP 服务器',
            description: (
              <div className="space-y-2.5">
                <p className="text-[12.5px] leading-5 text-ink-2">
                  仅支持 http/https/ws/wss 远程服务器，不支持 stdio(command) 启动。
                  可信附件服务器可单独设置 allowAttachmentUploads: true，允许上传已授权的 PDF/JPEG/PNG（最大 20 MiB）。
                </p>
                <Textarea
                  aria-label="MCP 配置 JSON"
                  value={mcpJson}
                  onChange={(event) => setMcpJson(event.target.value)}
                  spellCheck={false}
                  wrap="off"
                  className="min-h-40 overflow-x-auto font-mono text-[11.5px] leading-4 whitespace-pre"
                  placeholder={'{\n  "mcpServers": {\n    "example": {\n      "url": "https://example.com/mcp",\n      "headers": { "Authorization": "Bearer token" }\n    }\n  }\n}'}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void saveMcp()} disabled={mcpBusy}>
                    {mcpBusy ? '保存中…' : '保存并连接'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mcpBusy}
                    onClick={async () => {
                      setMcpBusy(true);
                      setMcpError('');
                      try {
                        const state = (await rpc('mcp.sync', {})) as McpState;
                        setMcpState(state);
                        setStatus('已重新连接 MCP 服务器');
                      } catch (error) {
                        setMcpError(error instanceof Error ? error.message : String(error));
                      } finally {
                        setMcpBusy(false);
                      }
                    }}
                  >
                    重新连接
                  </Button>
                </div>
                {mcpError && <p role="alert" className="text-[12.5px] leading-5 text-red">{mcpError}</p>}
                {mcpState && mcpState.servers.length > 0 && (
                  <ul className="space-y-1">
                    {mcpState.servers.map((server) => (
                      <li
                        key={server.name}
                        className="flex items-start gap-2 rounded-[8px] bg-inset px-2 py-1.5 text-[12.5px] leading-5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{server.name}</span>
                          <span className="block truncate text-ink-3">{server.url}</span>
                          {server.error && <span className="block truncate text-red">{server.error}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-ink-2">
                          {server.toolCount > 0 && <span className="text-ink-3">{server.toolCount} 工具</span>}
                          <AnimatedBadge
                            status={MCP_BADGE_STATUS[server.status]}
                            contentKey={`${server.name}-${server.status}`}
                          >
                            {MCP_STATUS_LABELS[server.status]}
                          </AnimatedBadge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          },
        ]}
      />

      <BouncyAccordion
        value={mcpToolsOpen ? 'mcp-tools' : null}
        onValueChange={(value) => setMcpToolsOpen(value === 'mcp-tools')}
        items={[
          {
            id: 'mcp-tools',
            title: 'MCP 工具',
            description: (
              <div className="space-y-2.5">
                <p className="text-[12.5px] leading-5 text-ink-2">
                  控制提供给模型的内置和 MCP 工具。关闭后，模型将无法看到或调用该工具。
                </p>
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  <div className="space-y-1">
                    <p className="sticky top-0 z-10 bg-card px-1 py-1 text-[11px] font-medium tracking-wide text-ink-3">
                      内置工具
                    </p>
                    {BUILTIN_TOOL_DISPLAY.map((tool) => (
                      <div
                        key={tool.name}
                        className="flex items-center gap-2 rounded-[8px] bg-inset px-2 py-1.5 text-[12.5px] leading-5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{tool.label}</span>
                          <span className="block truncate text-ink-3">{tool.name}</span>
                        </span>
                        <Switch
                          checked={!(settings.disabledBuiltinTools ?? []).includes(tool.name)}
                          onCheckedChange={(enabled) => setBuiltinToolEnabled(tool.name, enabled)}
                          aria-label={`启用内置工具 ${tool.label}`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <p className="sticky top-0 z-10 bg-card px-1 py-1 text-[11px] font-medium tracking-wide text-ink-3">
                      MCP 工具
                    </p>
                    {mcpState?.servers.some((server) => server.tools.length > 0) ? (
                      mcpState.servers.flatMap((server) =>
                        server.tools.map((tool) => (
                          <div
                            key={`${server.name}:${tool.originalName}`}
                            className="flex items-center gap-2 rounded-[8px] bg-inset px-2 py-1.5 text-[12.5px] leading-5"
                          >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-ink">{tool.name}</span>
                            <span className="block truncate text-ink-3">
                              {server.name}
                              {tool.description ? ` · ${tool.description}` : ''}
                            </span>
                          </span>
                            <Switch
                              checked={tool.enabled}
                              disabled={mcpBusy}
                              onCheckedChange={(enabled) =>
                                void setMcpToolEnabled(server.name, tool.originalName, enabled)
                              }
                              aria-label={`启用 MCP 工具 ${tool.name}`}
                            />
                          </div>
                        )),
                      )
                    ) : (
                      <p className="rounded-[8px] bg-inset px-2 py-2 text-[12.5px] text-ink-3">
                        暂无可用工具，请先连接 MCP 服务器。
                      </p>
                    )}
                  </div>
                </div>
                {mcpError && <p role="alert" className="text-[12.5px] leading-5 text-red">{mcpError}</p>}
              </div>
            ),
          },
        ]}
      />

      <section className="space-y-2.5 rounded-card border border-line bg-surface p-3">
        <h3 className="text-xs font-semibold tracking-wide text-ink-2">外观</h3>
        <div className="space-y-1.5">
          <Label htmlFor="theme">主题</Label>
          <Select
            value={settings.theme}
            onValueChange={(theme) => void patch({ theme: theme as AgentSettings['theme'] })}
          >
            <SelectTrigger id="theme" aria-label="主题" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">跟随系统</SelectItem>
              <SelectItem value="light">浅色</SelectItem>
              <SelectItem value="dark">深色</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="space-y-2.5 rounded-card border border-line bg-surface p-3">
        <h3 className="text-xs font-semibold tracking-wide text-ink-2">权限</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await requestOptionalPermissions({ allSites: true });
              await refresh();
            }}
          >
            {permissions?.allSites ? '已授予全站权限' : '授予全部网站'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await requestOptionalPermissions({ tabs: true });
              await refresh();
            }}
          >
            {permissions?.tabs ? '已授予标签页' : '授予标签页读取'}
          </Button>
        </div>
      </section>

      <p className="text-[11px] leading-5 text-ink-3">
        {status && <span className="mt-1 block text-ink-2">{status}</span>}
      </p>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          void patch({
            ...DEFAULT_SETTINGS,
            model: { ...DEFAULT_SETTINGS.model, baseURL: undefined },
            providerProfiles: {},
          })
        }
      >
        恢复默认
      </Button>
    </div>
  );
}
