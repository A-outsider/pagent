import type { BossListRow, BossPageState } from './content-adapter';

type ReceiptView = Pick<BossPageState, 'selectedKey' | 'headerName' | 'loading' | 'messages'>;

/** Check continuity of a conversation whose identity was verified before the send. */
export function classifyBossReceiptView(
  state: ReceiptView,
  recipient: Pick<BossListRow, 'key' | 'name'>,
  beforeIds: ReadonlySet<string>,
): 'matched' | 'pending' | 'changed' {
  if (state.selectedKey && state.selectedKey !== recipient.key || state.headerName && state.headerName !== recipient.name) {
    return 'changed';
  }
  if (state.loading || !state.headerName) return 'pending';
  if (state.selectedKey === recipient.key) return 'matched';
  // Sending can move the selected row outside the virtual list's rendered window. A retained
  // pre-send message anchors the unchanged right-hand conversation; a matching name alone cannot.
  if (state.selectedKey === undefined && state.messages.some((message) => beforeIds.has(message.id))) return 'matched';
  return 'pending';
}
