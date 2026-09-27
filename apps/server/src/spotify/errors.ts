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
