import { useEffect, useState } from 'react';
import { IconCheck, IconEdit, IconTrash } from '@tabler/icons-react';
import { BouncyAccordion } from '@/shared/ui/beui/bouncy-accordion';
import { Button } from '@/shared/ui/beui/button';
import { Input } from '@/shared/ui/beui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/beui/select';
import { Switch } from '@/shared/ui/beui/switch';
import { Label } from '@/shared/ui/label';
import { rpc } from '@/shared/extension/rpc-client';
import type { MemoryView } from '@/shared/contracts/memory';
import type { AgentSettings, AgentSettingsPatch, MemorySettings } from '@/shared/contracts/settings';

type MemoryGroups = {
  domain: string | null;
  global: MemoryView[];
  local: MemoryView[];
};

function MemoryEditor({
  memory,
  onChanged,
}: {
  memory: MemoryView;
  onChanged: () => Promise<void>;
}) {
  const [content, setContent] = useState(memory.content);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const next = content.trim();
    if (!next || next === memory.content) {
      setContent(memory.content);
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await rpc('memory.update', { id: memory.id, content: next });
      setEditing(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1 rounded-[8px] bg-inset px-2 py-1.5">
      {editing ? (
        <div className="min-w-0 flex-1">
          <Input
            autoFocus
            aria-label="编辑记忆内容"
            value={content}
            onValueChange={setContent}
            disabled={busy}
            className="h-8 bg-surface text-[12.5px]"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
              if (event.key === 'Escape') {
                setContent(memory.content);
                setEditing(false);
              }
            }}
          />
        </div>
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] leading-8 text-ink"
          title={memory.sourceUrl ? `${memory.content}\n${memory.sourceUrl}` : memory.content}
        >
          {memory.content}
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 shrink-0 p-0"
        disabled={busy}
        aria-label={editing ? '保存记忆' : '编辑记忆'}
        title={editing ? '保存' : '编辑'}
        onClick={() => {
          if (editing) void save();
          else setEditing(true);
        }}
      >
        {editing ? <IconCheck aria-hidden className="size-3.5" /> : <IconEdit aria-hidden className="size-3.5" />}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 shrink-0 p-0 text-red"
        disabled={busy}
        aria-label="删除记忆"
        title="删除"
        onClick={async () => {
          setBusy(true);
          try {
            await rpc('memory.delete', { id: memory.id });
            await onChanged();
          } finally {
            setBusy(false);
          }
        }}
      >
        <IconTrash aria-hidden className="size-3.5" />
      </Button>
    </div>
  );
}

function MemoryList({
  title,
  memories,
  onChanged,
}: {
  title: string;
  memories: MemoryView[];
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium tracking-wide text-ink-3">{title}</p>
      {memories.length ? (
        memories.map((memory) => (
          <MemoryEditor key={`${memory.id}:${memory.updatedAt}`} memory={memory} onChanged={onChanged} />
        ))
      ) : (
        <p className="rounded-[8px] bg-inset px-2 py-2 text-[12px] text-ink-3">暂无记忆</p>
      )}
    </div>
  );
}

export function MemorySettingsSection({
  settings,
  onPatch,
}: {
  settings: AgentSettings;
  onPatch: (patch: AgentSettingsPatch) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [groups, setGroups] = useState<MemoryGroups>({ domain: null, global: [], local: [] });
  const [status, setStatus] = useState('');
  const memory = settings.memory;

  const refresh = async () => {
    const [listed, secret] = await Promise.all([
      rpc('memory.list', {}) as Promise<MemoryGroups>,
      rpc('memory.secret.has', {}) as Promise<{ present: boolean }>,
    ]);
    setGroups(listed);
    setHasKey(secret.present);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const patchMemory = (patch: Partial<MemorySettings>) =>
    onPatch({ memory: { ...memory, ...patch } });

  return (
    <BouncyAccordion
      value={open ? 'memory' : null}
      onValueChange={(value) => setOpen(value === 'memory')}
      items={[
        {
          id: 'memory',
          title: '记忆系统',
          description: (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="min-w-0 flex-1">启用 Memory RAG</Label>
                <Switch
                  checked={memory.enabled}
                  onCheckedChange={(enabled) => void patchMemory({ enabled })}
                  aria-label="启用 Memory RAG"
                />
              </div>
              <div className="space-y-1.5">
                <Label>服务类型</Label>
                <Select
                  value={memory.provider}
                  onValueChange={(provider) =>
                    void patchMemory({ provider: provider as MemorySettings['provider'] })
                  }
                >
                  <SelectTrigger aria-label="Memory 服务类型" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jina">Jina AI</SelectItem>
                    <SelectItem value="custom">自定义兼容端点</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Embedding Endpoint</Label>
                <Input
                  value={memory.embeddingEndpoint}
                  onValueChange={(embeddingEndpoint) => void patchMemory({ embeddingEndpoint })}
                />
                <Label>Embedding Model</Label>
                <Input
                  value={memory.embeddingModel}
                  onValueChange={(embeddingModel) => void patchMemory({ embeddingModel })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Reranker Endpoint</Label>
                <Input
                  value={memory.rerankerEndpoint}
                  onValueChange={(rerankerEndpoint) => void patchMemory({ rerankerEndpoint })}
                />
                <Label>Reranker Model</Label>
                <Input
                  value={memory.rerankerModel}
                  onValueChange={(rerankerModel) => void patchMemory({ rerankerModel })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Memory API Key</Label>
                <Input
                  type="password"
                  value={key}
                  onValueChange={setKey}
                  placeholder={hasKey ? '已保存密钥，输入新值覆盖' : 'jina_…'}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!key.trim()}
                    onClick={async () => {
                      await rpc('memory.secret.set', { apiKey: key.trim() });
                      setKey('');
                      setStatus('Memory API Key 已保存');
                      await refresh();
                    }}
                  >
                    保存密钥
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      setStatus('正在测试…');
                      try {
                        const result = (await rpc('memory.test', {})) as { dimensions: number };
                        setStatus(`连接成功，向量维度 ${result.dimensions}`);
                      } catch (error) {
                        setStatus(error instanceof Error ? error.message : String(error));
                      }
                    }}
                  >
                    测试连接
                  </Button>
                </div>
                {status && <p className="text-[11.5px] leading-5 text-ink-2">{status}</p>}
              </div>
              <MemoryList title="全局记忆" memories={groups.global} onChanged={refresh} />
              <MemoryList
                title={`当前局部记忆${groups.domain ? ` · ${groups.domain}` : ''}`}
                memories={groups.local}
                onChanged={refresh}
              />
            </div>
          ),
        },
      ]}
    />
  );
}
