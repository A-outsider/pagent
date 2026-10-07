import { DEFAULT_BOSS_GREETING, bossStartFavoritesTaskSchema, bossFavoritesPreferencesSchema, type BossStartFavoritesTaskRequest, type BossStartFavoritesInput } from '@/shared/contracts/boss-favorites';
import { idbGet, idbSet } from '@/shared/storage/idb';

const KEY = 'boss-favorites-preferences';
export async function getBossFavoritesPreferences() {
  const result = bossFavoritesPreferencesSchema.safeParse(await idbGet('meta', KEY));
  return result.success ? result.data : { greeting: DEFAULT_BOSS_GREETING, maxRecipients: 10 };
}
export async function saveBossFavoritesPreferences(input: unknown) {
  const value = bossFavoritesPreferencesSchema.parse(input);
  await idbSet('meta', KEY, value);
  return value;
}
export async function resolveBossFavoritesRequest(input: BossStartFavoritesInput): Promise<BossStartFavoritesTaskRequest> {
  const preferences = await getBossFavoritesPreferences();
  return bossStartFavoritesTaskSchema.parse({ ...input, greeting: input.greeting ?? preferences.greeting });
}
