import type { PageObserver } from '@/features/page/observer';

export function sameBossChatDocument(
  previousUrl: string,
  nextUrl: string,
  previousRoot: Element | null,
  currentRoot: Element | null,
): boolean {
  if (!currentRoot?.isConnected || previousRoot !== currentRoot) return false;
  try {
    return [previousUrl, nextUrl].every((value) => {
      const url = new URL(value);
      return url.origin === 'https://www.zhipin.com' && url.pathname === '/web/geek/chat';
    });
  } catch { return false; }
}

type NavigationState = { url: string; chatRoot: Element | null };

/** Preserve only the verified, unchanged BOSS chat document; every event still invalidates element revisions. */
export function createBossNavigationHandler(
  observer: Pick<PageObserver, 'bump'>,
  readState: () => NavigationState = () => ({ url: location.href, chatRoot: document.querySelector('.chat-container') }),
): () => void {
  let previous = readState();
  return () => {
    const current = readState();
    observer.bump({ preserveDocumentId: sameBossChatDocument(previous.url, current.url, previous.chatRoot, current.chatRoot) });
    previous = current;
  };
}
