import { z } from 'zod';

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  scope: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});

export type SpotifyTokenResponse = z.infer<typeof tokenResponseSchema>;

export const meProfileSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
});

export type SpotifyMeProfile = z.infer<typeof meProfileSchema>;
