import { useEffect, useState } from 'react';
import { rpc } from '@/shared/extension/rpc-client';
import { applyDocumentTheme, resolveThemeClass } from '@/shared/extension/theme';
import type { AgentSettings } from '@/shared/contracts/settings';
import { Button } from '@/shared/ui/beui/button';
import { Switch } from '@/shared/ui/beui/switch';
import { BotIcon } from '@/shared/ui/BotIcon';

export function PopupApp() {
  const [settings, setSettings] = useState<AgentSettings>();
  const [currentHidden, setCurrentHidden] = useState(false);
  const [permanentlyHidden, setPermanentlyHidden] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([rpc('settings.get', {}), rpc('menu.getState', {})])
      .then(([settingsValue, menuValue]) => {
        const menu = menuValue as { currentHidden?: boolean; permanentlyHidden?: boolean };
        setSettings(settingsValue as AgentSettings);
        setCurrentHidden(Boolean(menu.currentHidden));
        setPermanentlyHidden(Boolean(menu.permanentlyHidden));
      })
      .catch((item) => setError(item instanceof Error ? item.message : String(item)));
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () =>
      applyDocumentTheme(resolveThemeClass(settings?.theme ?? 'system', media.matches));
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [settings?.theme]);

  const run = async (name: string, action: () => Promise<unknown>, close = true) => {
    setBusy(name);
    setError('');
    try {
      await action();
      if (close) window.close();
    } catch (item) {
      setError(item instanceof Error ? item.message : String(item));
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="w-89 bg-surface text-ink">
      <section>
        <header className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <span className="pagent-settings-logo" aria-hidden>
            <BotIcon size={34} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[14px] font-semibold tracking-[-0.01em]">Pagent</h1>
            <p className="truncate text-[11px] text-ink-3">
              {settings ? `${settings.model.provider} · ${settings.model.model}` : '页面内智能 Agent'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2.5 text-[11.5px] text-ink-2"
            onClick={() => void browser.runtime.openOptionsPage()}
          >
            设置
          </Button>
        </header>

        <div className="p-4">
          <Button
            disabled={Boolean(busy)}
            onClick={() => void run('open', () => rpc('menu.openCurrent', {}))}
            className="h-10 w-full rounded-xl text-[13px] font-semibold"
          >
            {busy === 'open' ? '正在打开…' : '在当前页面打开'}
          </Button>

          <div className="my-4 h-px bg-line" />

          <div className="mb-2 text-[10px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
            显示设置
          </div>
          <div className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium">在当前页面隐藏</span>
              <span className="mt-0.5 block text-[10.5px] leading-4 text-ink-3">刷新页面后自动恢复显示</span>
            </span>
            <Switch
              checked={currentHidden}
              disabled={Boolean(busy) || permanentlyHidden}
              onCheckedChange={(hidden) => {
                setCurrentHidden(hidden);
                void run(
                  'current',
                  () => rpc(hidden ? 'menu.hideCurrent' : 'menu.openCurrent', {}),
                  false,
                );
              }}
              aria-label="在当前页面隐藏"
            />
          </div>

          <div className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium">永久隐藏悬浮入口</span>
              <span className="mt-0.5 block text-[10.5px] leading-4 text-ink-3">
                在所有网页隐藏，可随时从此处恢复
              </span>
            </span>
            <Switch
              checked={permanentlyHidden}
              disabled={Boolean(busy)}
              onCheckedChange={(hidden) =>
                void run(
                  'permanent',
                  async () => {
                    await rpc('menu.setPermanentlyHidden', { hidden });
                    setPermanentlyHidden(hidden);
                  },
                  false,
                )
              }
              aria-label="永久隐藏悬浮入口"
            />
          </div>
        </div>
      </section>

      {error && (
        <p role="alert" className="mx-4 mb-4 rounded-lg bg-red-tint px-3 py-2 text-[11px] leading-4 text-red">
          {error}
        </p>
      )}
    </main>
  );
}
