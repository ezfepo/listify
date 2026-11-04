import { describe, expect, it } from 'vitest';
import { SpotifyAuthError, SpotifyHttpError, SpotifyRateLimitError } from './errors.js';

describe('Spotify errors', () => {
  it('SpotifyAuthError carries a machine-readable reason', () => {
    const err = new SpotifyAuthError('reconnect_required', 'refresh failed');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SpotifyAuthError');
    expect(err.reason).toBe('reconnect_required');
    expect(err.message).toBe('refresh failed');
  });

  it('SpotifyRateLimitError is distinguishable by name and class', () => {
    const err = new SpotifyRateLimitError('slow down');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SpotifyRateLimitError');
  });

  it('SpotifyHttpError carries the HTTP status', () => {
    const err = new SpotifyHttpError(404, 'no active device');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SpotifyHttpError');
    expect(err.status).toBe(404);
  });
});
