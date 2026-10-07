import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconBrowser, IconCheck, IconCommand, IconDownload, IconMinus, IconPointer, IconRefresh, IconSearch } from '@tabler/icons-react';
import { Button } from '@/shared/ui/beui/button';
import { Input } from '@/shared/ui/beui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/beui/select';
import { Switch } from '@/shared/ui/beui/switch';
import { Label } from '@/shared/ui/label';
import { rpc } from '@/shared/extension/rpc-client';
import {
  formatConversationTime,
  groupConversationsByTime,
} from '@/features/agent/session/conversations';
import {
  downloadTextFile,
  exportFilename,
  exportedConversationsToMarkdown,
  type ConversationExportBundle,
  type ExportedConversation,
} from './conversation-archive';
import type { ConversationSummary } from '@/shared/contracts/session';

type ListResult = {
  conversations: ConversationSummary[];
  vaults: Array<{ domain: string; conversationCount: number; updatedAt: number }>;
};

function Check({
  checked,
  indeterminate = false,
  onChange,
  label,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  ariaLabel?: string;
}) {
  return (
    <label className="group inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel ?? label}
        ref={(node) => {
          if (node) node.indeterminate = indeterminate;
        }}
        className="peer ml-2 sr-only"
      />
      <span
        aria-hidden
        className={`grid size-5.5 shrink-0 place-items-center rounded-full border transition-all duration-150 group-hover:border-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
          checked || indeterminate
            ? 'border-accent bg-accent text-white shadow-sm'
            : 'border-line-strong bg-page text-transparent'
        }`}
      >
        {indeterminate
          ? <IconMinus className="size-4" stroke={2.8} />
          : <IconCheck className={`size-4 transition-transform ${checked ? 'scale-100' : 'scale-75'}`} stroke={2.8} />}
      </span>
      {label ? <span className="text-[12.5px] text-ink-2">{label}</span> : null}
    </label>
  );
}

function roleLabel(role: ExportedConversation['transcript'][number]['role']): string {
  if (role === 'user') return '用户';
  if (role === 'assistant') return '助手';
  return '系统';
}

function PreviewTurn({ turn }: { turn: ExportedConversation['transcript'][number] }) {
  return (
    <article className="space-y-1.5 rounded-card border border-line bg-page px-3 py-2.5">
      <div className="text-[11px] font-medium tracking-wide text-ink-3">{roleLabel(turn.role)}</div>
      {turn.hasImage && <p className="text-[12px] text-ink-3">{turn.imageDataUrl ? '含截图附件' : '含截图（导出时可附带）'}</p>}
      {turn.badges && turn.badges.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {turn.badges.map((badge, idx) => {
            if (badge.type === 'tab') {
              return (
                <span
                  key={`tab-${badge.id}-${idx}`}
                  className="flex h-5 items-center gap-1 rounded-chip bg-inset px-1.5 text-[10.5px] text-ink-2"
                >
                  <IconBrowser size={11} stroke={2} className="shrink-0" />
                  <span className="max-w-36 truncate">{badge.title}</span>
                </span>
              );
            }
            if (badge.type === 'command') {
              return (
                <span
                  key={`cmd-${badge.key}-${idx}`}
                  className="flex h-5 items-center gap-1 rounded-chip bg-primary/12 px-1.5 text-[10.5px] font-medium text-accent-ink"
                >
                  <IconCommand size={11} stroke={2} className="shrink-0" />
                  <span className="max-w-28 truncate">/{badge.key}</span>
                  {badge.name && <span className="max-w-24 truncate text-ink-3">({badge.name})</span>}
                </span>
              );
            }
            if (badge.type === 'element') {
              return (
                <span
                  key={`el-${idx}`}
                  className="flex h-5 items-center gap-1 rounded-chip bg-inset px-1.5 text-[10.5px] text-ink-2"
                >
                  <IconPointer size={11} stroke={2} className="shrink-0" />
                  <span className="max-w-36 truncate">{badge.name || (badge.tag ? `<${badge.tag}>` : '页面元素')}</span>
                </span>
              );
            }
            return null;
          })}
        </div>
      )}
      {turn.thinking && (
        <p className="whitespace-pre-wrap text-[12px] leading-5 text-ink-3">{turn.thinking}</p>
      )}
      {turn.tools?.map((tool) => (
        <div key={tool.id} className="rounded-[8px] bg-inset px-2 py-1.5 text-[12px] leading-5">
          <div className="font-medium text-ink">{tool.label}</div>
          {tool.output && <div className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-ink-3">{tool.output}</div>}
        </div>
      ))}
      {turn.text && <p className="whitespace-pre-wrap text-[13px] leading-5 text-ink">{turn.text}</p>}
    </article>
  );
}

export function ConversationArchive() {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [vaults, setVaults] = useState<ListResult['vaults']>([]);
  const [query, setQuery] = useState('');
  const [vault, setVault] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string>();
  const [preview, setPreview] = useState<ExportedConversation>();
  const [includeImages, setIncludeImages] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = (await rpc('conversations.list', {})) as ListResult;
      setItems(result.conversations);
      setVaults(result.vaults);
      setSelected((current) => {
        const ids = new Set(result.conversations.map((item) => item.id));
        return new Set([...current].filter((id) => ids.has(id)));
      });
    } catch (item) {
      setError(item instanceof Error ? item.message : String(item));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (vault !== 'all' && !item.vaults.includes(vault)) return false;
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        item.preview.toLowerCase().includes(needle) ||
        item.vaults.some((domain) => domain.includes(needle))
      );
    });
  }, [items, query, vault]);

  const groups = useMemo(() => groupConversationsByTime(filtered), [filtered]);
  const selectedCount = selected.size;
  const visibleIds = filtered.map((item) => item.id);
  const visibleSelectedCount = visibleIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  useEffect(() => {
    if (!previewId) {
      setPreview(undefined);
      return;
    }
    let cancelled = false;
    void rpc('conversations.get', { ids: [previewId], includeImages: false })
      .then((result) => {
        if (cancelled) return;
        const next = (result as { conversations: ExportedConversation[] }).conversations[0];
        setPreview(next);
      })
      .catch((item) => {
        if (!cancelled) setError(item instanceof Error ? item.message : String(item));
      });
    return () => {
      cancelled = true;
    };
  }, [previewId]);

  const toggle = (id: string, value: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
    setPreviewId(id);
  };

  const toggleVisible = (value: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const exportSelected = async (kind: 'json' | 'jsonl' | 'md') => {
    if (!selectedCount) return;
    setExporting(true);
    setError('');
    try {
      const result = (await rpc('conversations.get', {
        ids: [...selected],
        includeImages,
      })) as { conversations: ExportedConversation[] };
      const conversations = result.conversations;
      if (!conversations.length) throw new Error('没有找到所选会话');
      if (kind === 'md') {
        downloadTextFile(exportFilename('md'), exportedConversationsToMarkdown(conversations), 'text/markdown');
        return;
      }
      if (kind === 'jsonl') {
        downloadTextFile(
          exportFilename('jsonl'),
          `${conversations.map((item) => JSON.stringify(item)).join('\n')}\n`,
          'application/jsonl',
        );
        return;
      }
      const bundle: ConversationExportBundle = {
        exportedAt: new Date().toISOString(),
        source: 'pagent',
        version: 1,
        conversationCount: conversations.length,
        conversations,
      };
      downloadTextFile(exportFilename('json'), `${JSON.stringify(bundle, null, 2)}\n`, 'application/json');
    } catch (item) {
      setError(item instanceof Error ? item.message : String(item));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">聊天记录</h2>
        <p className="mt-1 text-[13px] leading-5 text-ink-2">
          从本地 Vault 选取会话并导出，便于离线分析。默认不包含截图以减小体积。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input
            aria-label="搜索会话"
            value={query}
            onValueChange={setQuery}
            placeholder="搜索标题、内容或站点"
            leftIcon={<IconSearch className="size-3.5" />}
          />
        </div>
        <div className="w-52">
          <Label htmlFor="vault-filter">站点</Label>
          <Select value={vault} onValueChange={setVault}>
            <SelectTrigger id="vault-filter" aria-label="按站点筛选" className="mt-1.5 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{`全部站点${items.length ? `（${items.length}）` : ''}`}</SelectItem>
              {vaults.map((item) => (
                <SelectItem key={item.domain} value={item.domain}>
                  {`${item.domain}（${item.conversationCount}）`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <IconRefresh className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-3 py-2.5">
        <Check
          checked={allVisibleSelected}
          indeterminate={visibleSelectedCount > 0 && !allVisibleSelected}
          onChange={toggleVisible}
          label={`全选当前列表（${filtered.length}）`}
        />
        <span className="text-[12.5px] text-ink-3">已选 {selectedCount} 条</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Switch
            checked={includeImages}
            onCheckedChange={setIncludeImages}
            label={<span className="text-[12.5px] text-ink-2">包含截图</span>}
          />
          <Button size="sm" variant="outline" disabled={!selectedCount || exporting} onClick={() => void exportSelected('json')}>
            <IconDownload className="size-3.5" />
            JSON
          </Button>
          <Button size="sm" variant="outline" disabled={!selectedCount || exporting} onClick={() => void exportSelected('jsonl')}>
            JSONL
          </Button>
          <Button size="sm" disabled={!selectedCount || exporting} onClick={() => void exportSelected('md')}>
            Markdown
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-card bg-red-tint px-3 py-2 text-[12.5px] text-red">
          {error}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="min-h-80 overflow-hidden rounded-window border border-line bg-surface">
          {loading && !items.length ? (
            <p className="px-4 py-16 text-center text-[13px] text-ink-3">正在读取本地会话…</p>
          ) : groups.length === 0 ? (
            <p className="px-4 py-16 text-center text-[13px] text-ink-3">
              {items.length ? '没有匹配的会话' : '还没有可导出的会话。在网页中与 Pagent 对话后，记录会按站点保存在本地。'}
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto p-2">
              {groups.map((group) => (
                <section key={group.key} className="mb-2 last:mb-0">
                  <h3 className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-ink-3">
                    {group.label}
                  </h3>
                  {group.items.map((item) => {
                    const checked = selected.has(item.id);
                    const active = previewId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`flex items-start gap-2 rounded-card px-2 py-2 ${
                          active ? 'bg-accent-tint' : checked ? 'bg-inset' : 'hover:bg-hover'
                        }`}
                      >
                        <div className="flex self-stretch items-center">
                          <Check
                            checked={checked}
                            onChange={(value) => toggle(item.id, value)}
                            ariaLabel={`选择${item.title}`}
                          />
                        </div>
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            setPreviewId(item.id);
                            if (!selected.has(item.id)) toggle(item.id, true);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 truncate text-[13px] font-medium text-ink">{item.title}</span>
                            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-3">
                              {formatConversationTime(item.updatedAt)}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[12px] text-ink-3">
                            {item.vaults.join(' · ') || '未归档站点'}
                            {item.messageCount ? ` · ${item.messageCount} 条消息` : ''}
                          </div>
                          {item.preview && (
                            <div className="mt-0.5 truncate text-[12px] text-ink-2">{item.preview}</div>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </section>

        <aside className="min-h-80 overflow-hidden rounded-window border border-line bg-surface">
          {!preview ? (
            <p className="px-4 py-16 text-center text-[13px] text-ink-3">选择一条会话预览内容和工具调用。</p>
          ) : (
            <div className="flex max-h-[70vh] flex-col">
              <div className="border-b border-line px-4 py-3">
                <h3 className="truncate text-[14px] font-medium text-ink">{preview.title}</h3>
                <p className="mt-1 text-[12px] text-ink-3">
                  {preview.vaults.join(' · ') || '未归档站点'} · {preview.messageCount} 条消息
                </p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                {preview.transcript.map((turn) => (
                  <PreviewTurn key={turn.id} turn={turn} />
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
