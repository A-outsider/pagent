export function resolveThemeClass(theme: 'light' | 'dark' | 'system', systemDark = false): string {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return '';
  return systemDark ? 'dark' : '';
}

export function applyDocumentTheme(themeClass: string) {
  document.documentElement.classList.toggle('dark', themeClass === 'dark');
  document.documentElement.style.colorScheme = themeClass === 'dark' ? 'dark' : 'light';
}

export function applyShadowTheme(anchor: Element | null, themeClass: string) {
  const root = anchor?.getRootNode();
  if (!(root instanceof ShadowRoot)) return;
  const dark = themeClass === 'dark';
  root.host.classList.toggle('dark', dark);
  root.querySelector('[data-pagent-ui]')?.classList.toggle('dark', dark);
  root.querySelector('[data-pagent-portals]')?.classList.toggle('dark', dark);
}
