import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../../.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

export const SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

export const config = {
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID ?? '',
  spotifyRedirectUri: process.env.SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:8787/auth/callback',
  webOrigin: process.env.LISTIFY_WEB_ORIGIN ?? 'http://127.0.0.1:5173',
};
