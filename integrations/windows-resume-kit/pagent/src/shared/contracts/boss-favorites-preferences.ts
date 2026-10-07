import { z } from 'zod';
import { bossFavoritesPreferencesSchema } from './boss-favorites.ts';

export const bossGetFavoritesPreferencesSchema = z.object({}).strict();
export const bossSetFavoritesGreetingSchema = z.object({
  greeting: bossFavoritesPreferencesSchema.shape.greeting,
}).strict();
