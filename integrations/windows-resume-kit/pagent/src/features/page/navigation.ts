export const PAGE_NAVIGATION_EVENT = 'pagent:page-navigation';

type NavigationWindow = Window & {
  __pagentNavigationEvents?: boolean;
  navigation?: EventTarget;
};

export function installPageNavigationEvents(target: Window = window): void {
  const state = target as NavigationWindow;
  if (state.__pagentNavigationEvents) return;
  state.__pagentNavigationEvents = true;
  const notify = () => target.dispatchEvent(new Event(PAGE_NAVIGATION_EVENT));
  const targetHistory = target.history;
  const pushState = targetHistory.pushState.bind(targetHistory);
  targetHistory.pushState = (data, unused, url) => {
    pushState(data, unused, url);
    queueMicrotask(notify);
  };
  const replaceState = targetHistory.replaceState.bind(targetHistory);
  targetHistory.replaceState = (data, unused, url) => {
    replaceState(data, unused, url);
    queueMicrotask(notify);
  };
  state.navigation?.addEventListener('navigatesuccess', notify);
}
