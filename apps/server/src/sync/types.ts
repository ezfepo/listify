export interface NormalizedTrack {
  uri: string;
  name: string;
  artists: string;
  album: string | null;
  imageUrl: string | null;
  durationMs: number | null;
  addedAt: string | null;
  isLocal: boolean;
}
