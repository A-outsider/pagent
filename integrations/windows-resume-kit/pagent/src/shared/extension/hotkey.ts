export const TOGGLE_PANEL_COMMAND = 'toggle-pagent';
export const TOGGLE_PANEL_HOTKEY_LABEL = 'Alt+P';

export function isTogglePanelHotkey(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>,
): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return event.code === 'KeyP' || event.key.toLowerCase() === 'p';
}

export function isTeachingCommentElementHotkey(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>,
): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return event.code === 'KeyX' || event.key.toLowerCase() === 'x';
}

export function isTeachingCommentDirectHotkey(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>,
): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return event.code === 'KeyC' || event.key.toLowerCase() === 'c';
}
