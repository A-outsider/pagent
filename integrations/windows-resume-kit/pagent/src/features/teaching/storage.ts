import type { SavedCommand, TeachingSession } from '@/shared/contracts/teaching';
import { idbDelete, idbGet, idbGetAll, idbSet, SESSION_STORES } from '@/shared/storage/idb';

const ACTIVE_SESSION_KEY = 'active';

export async function loadTeachingSession(): Promise<TeachingSession | null> {
  return (await idbGet<TeachingSession>(SESSION_STORES.teaching, ACTIVE_SESSION_KEY)) ?? null;
}

export async function saveTeachingSession(session: TeachingSession): Promise<void> {
  await idbSet(SESSION_STORES.teaching, ACTIVE_SESSION_KEY, session);
}

export async function clearTeachingSession(): Promise<void> {
  await idbDelete(SESSION_STORES.teaching, ACTIVE_SESSION_KEY);
}

export async function loadCommands(domain: string): Promise<SavedCommand[]> {
  return (await idbGet<SavedCommand[]>(SESSION_STORES.commands, domain)) ?? [];
}

export async function loadAllCommands(): Promise<Record<string, SavedCommand[]>> {
  return idbGetAll<SavedCommand[]>(SESSION_STORES.commands);
}

export async function saveCommand(command: SavedCommand): Promise<SavedCommand> {
  const commands = await loadCommands(command.vaultDomain);
  const next = commands.filter((item) => item.id !== command.id);
  next.push(command);
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  await idbSet(SESSION_STORES.commands, command.vaultDomain, next);
  return command;
}
