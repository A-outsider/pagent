import { useEffect, useState } from 'react';
import {
  clearRememberedSelection,
  getRememberedSelection,
  installPageSelectionTracker,
  subscribePageSelection,
} from '@/features/page/selection';
import { PAGE_NAVIGATION_EVENT } from '@/features/page/navigation';

export type PageContextState = {
  url: string;
  title: string;
  selection: string;
};

export function usePageContext() {
  const [page, setPage] = useState<PageContextState>({
    url: location.href,
    title: document.title,
    selection: '',
  });

  useEffect(() => {
    installPageSelectionTracker();
    const sync = () =>
      setPage({
        url: location.href,
        title: document.title,
        selection: getRememberedSelection(),
      });
    sync();
    const unsubscribe = subscribePageSelection(sync);
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const onNavigate = () => queueMicrotask(sync);
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    window.addEventListener(PAGE_NAVIGATION_EVENT, sync);
    navigation?.addEventListener('navigatesuccess', onNavigate);
    return () => {
      unsubscribe();
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      window.removeEventListener(PAGE_NAVIGATION_EVENT, sync);
      navigation?.removeEventListener('navigatesuccess', onNavigate);
    };
  }, []);

  return { page, clearSelection: clearRememberedSelection };
}
