import type { ChatMessage } from '@/shared/contracts/session-messages';

export function messagesAfter(messages: ChatMessage[], cutoffId: string | undefined): ChatMessage[] {
  if (!cutoffId) return messages;
  const index = messages.findIndex((message) => message.id === cutoffId);
  return index === -1 ? messages : messages.slice(index + 1);
}

export function lastRoundStartIndex(messages: ChatMessage[]): number {
  let start = 0;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === 'user') start = index;
  }
  return start;
}

export function windowStartIndex(messages: ChatMessage[], fromId?: string): number {
  if (!fromId) return lastRoundStartIndex(messages);
  const index = messages.findIndex((message) => message.id === fromId);
  return index === -1 ? lastRoundStartIndex(messages) : index;
}

export function visibleWindow(messages: ChatMessage[], fromId?: string): ChatMessage[] {
  return messages.slice(windowStartIndex(messages, fromId));
}

export function visibleWindowStartId(
  messages: ChatMessage[],
  fromId?: string,
): string | undefined {
  return fromId ?? messages[windowStartIndex(messages)]?.id;
}

export function olderRoundStartId(messages: ChatMessage[], fromId?: string): string | undefined {
  const start = windowStartIndex(messages, fromId);
  if (start <= 0) return undefined;
  return messages[lastRoundStartIndex(messages.slice(0, start))]?.id;
}
