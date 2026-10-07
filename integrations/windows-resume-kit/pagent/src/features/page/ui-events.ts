export const uiEvents = new EventTarget();

export type UiCommand =
  | 'ui.toggle'
  | 'ui.open'
  | 'ui.collapse'
  | 'ui.hide'
  | 'ui.capture.start'
  | 'ui.capture.end';

export function dispatchUiCommand(name: UiCommand) {
  if (name === 'ui.toggle') uiEvents.dispatchEvent(new CustomEvent('toggle'));
  if (name === 'ui.open') uiEvents.dispatchEvent(new CustomEvent('open'));
  if (name === 'ui.collapse') uiEvents.dispatchEvent(new CustomEvent('collapse'));
  if (name === 'ui.hide') uiEvents.dispatchEvent(new CustomEvent('hide'));
  if (name === 'ui.capture.start') uiEvents.dispatchEvent(new CustomEvent('capture-start'));
  if (name === 'ui.capture.end') uiEvents.dispatchEvent(new CustomEvent('capture-end'));
}
