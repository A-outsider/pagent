export function resolveShadowPortal(anchor?: Element | null): HTMLElement | undefined {
  const root = anchor?.getRootNode();
  if (!(root instanceof ShadowRoot)) return undefined;

  const existing = root.querySelector<HTMLElement>('[data-pagent-portals]');
  if (existing) {
    existing.classList.toggle('dark', root.host.classList.contains('dark'));
    return existing;
  }

  const host = document.createElement('div');
  host.dataset.pagentPortals = 'true';
  host.classList.toggle('dark', root.host.classList.contains('dark'));
  host.style.position = 'fixed';
  host.style.inset = 'auto';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '2147483647';
  root.append(host);
  return host;
}
