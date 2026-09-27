export class SpotifyAuthError extends Error {
  reason: 'not_connected' | 'reconnect_required';

  constructor(reason: 'not_connected' | 'reconnect_required', message: string) {
    super(message);
    this.name = 'SpotifyAuthError';
    this.reason = reason;
  }
}

export class SpotifyRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotifyRateLimitError';
  }
}

/** A non-2xx, non-429 response from a direct (non-spotifyGet) Spotify API call. */
export class SpotifyHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SpotifyHttpError';
    this.status = status;
  }
}
