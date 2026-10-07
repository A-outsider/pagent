import { useEffect, useState } from 'react';
import PromptBar from '@/shared/ui/beautiful-ui/primitives/PromptBar';
import { rpc } from '@/shared/extension/rpc-client';
import {
  resolveModelList,
  modelsForProvider,
  resolveCatalogModel,
  type AgentSettings,
  type CatalogModel,
  type ProviderId,
} from '@/shared/contracts/settings';
import type { ObservedElement } from '@/shared/contracts/page';
import type { UserBadge, UserReference } from '@/shared/contracts/session-messages';

export function Composer({
  settings,
  running,
  onSubmit,
  onStop,
  onSettingsChange,
  imageDataUrl,
  onMarkScreen,
  onRemoveImage,
  selectedElement,
  selectingElement,
  onSelectElement,
  onRemoveElement,
  onStartTeaching,
  placeholder,
}: {
  settings: AgentSettings;
  running: boolean;
  onSubmit: (
    prompt: string,
    context?: string,
    imageDataUrl?: string,
    badges?: UserBadge[],
    references?: UserReference[],
  ) => void;
  onStop: () => void;
  onSettingsChange: (settings: AgentSettings) => void;
  imageDataUrl?: string;
  onMarkScreen: () => void;
  onRemoveImage: () => void;
  selectedElement?: ObservedElement;
  selectingElement: boolean;
  onSelectElement: () => void;
  onRemoveElement: () => void;
  onStartTeaching: () => void;
  placeholder?: string;
}) {
  const provider = settings.model.provider;
  const [remoteModels, setRemoteModels] = useState<Partial<Record<ProviderId, CatalogModel[]>>>({});

  // 与设置页保持一致：自动拉取该服务商的在线模型列表（后台缓存 5 分钟），失败时回退静态目录
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void rpc('models.list', { provider, baseURL: settings.model.baseURL })
        .then((models) => {
          if (cancelled) return;
          setRemoteModels((prev) => ({ ...prev, [provider]: models as CatalogModel[] }));
        })
        .catch(() => {
          if (cancelled) return;
          setRemoteModels((prev) => ({ ...prev, [provider]: undefined }));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [provider, settings.model.baseURL]);

  const availableModels = resolveModelList(modelsForProvider(provider), remoteModels[provider]);
  const models = [
    ...availableModels,
    ...(availableModels.some((item) => item.id === settings.model.model)
      ? []
      : [resolveCatalogModel(provider, settings.model.model)]),
  ].map(
    (item) => ({ key: item.id, name: item.label, tag: item.tag }),
  );

  return (
    <div className="mt-auto shrink-0 bg-page p-2 pb-3">
      <PromptBar
        demo={false}
        placeholder={placeholder ?? "给当前页面下达任务…"}
        running={running}
        onSend={onSubmit}
        onStop={onStop}
        imageDataUrl={imageDataUrl}
        onMarkScreen={onMarkScreen}
        onRemoveImage={onRemoveImage}
        selectedElement={selectedElement}
        selectingElement={selectingElement}
        onSelectElement={onSelectElement}
        onRemoveElement={onRemoveElement}
        onStartTeaching={onStartTeaching}
        modelKey={settings.model.model}
        models={models}
        onModelChange={(id) => {
          const next = resolveCatalogModel(provider, id);
          void rpc('settings.set', {
            model: {
              ...settings.model,
              model: next.id,
              apiProtocol: next.apiProtocol,
            },
          }).then((saved) => onSettingsChange(saved as AgentSettings));
        }}
      />
    </div>
  );
}
