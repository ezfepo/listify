export type FeatureKey =
  | 'valence'
  | 'energy'
  | 'danceability'
  | 'tempo'
  | 'acousticness'
  | 'instrumentalness'
  | 'speechiness'
  | 'loudness';

export const FEATURE_KEYS: FeatureKey[] = [
  'valence',
  'energy',
  'danceability',
  'tempo',
  'acousticness',
  'instrumentalness',
  'speechiness',
  'loudness',
];

export type TrackStatus = 'inbox' | 'organized' | 'skipped';

export interface TrackView {
  uri: string;
  name: string;
  artists: string;
  album: string | null;
  imageUrl: string | null;
  isrc: string | null;
  status: TrackStatus;
  inMain: boolean;
  inArchive: boolean;
  features: Partial<Record<FeatureKey, number>> | null;
  tags: { tag: string; weight: number; source: string }[];
  enrichment: { source: string; status: string; ts: string }[];
  playlists: { id: number; name: string }[];
}

export type PlaylistKind = 'main' | 'archive' | 'sub';

export interface PlaylistView {
  id: number;
  spotifyId: string | null;
  name: string;
  kind: PlaylistKind;
  criteriaNote: string | null;
  emoji: string | null;
  color: string | null;
  sortOrder: number;
  trackCount: number;
}

export interface StatusCounts {
  inbox: number;
  organized: number;
  skipped: number;
}

export interface LibraryResponse {
  playlists: PlaylistView[];
  statusCounts: StatusCounts;
}

export type FeatureRanges = Partial<Record<FeatureKey, [number, number]>>;

export interface Recipe {
  playlistId: number;
  includeTags: string[];
  excludeTags: string[];
  featureRanges: FeatureRanges;
}

export interface PlaylistSuggestion {
  playlistId: number;
  playlistName: string;
  score: number;
  reason: string;
}

export interface TrackSuggestion {
  uri: string;
  name: string;
  artists: string;
  score: number;
  reason: string;
}

export interface TracksListResponse {
  total: number;
  items: TrackView[];
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? body.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getLibrary: () => request<LibraryResponse>('/api/library'),

  createPlaylist: (input: {
    name: string;
    criteriaNote?: string;
    emoji?: string;
    color?: string;
  }) => request<PlaylistView>('/api/playlists', { method: 'POST', body: JSON.stringify(input) }),

  updatePlaylist: (
    id: number,
    input: Partial<{
      name: string;
      criteriaNote: string | null;
      emoji: string | null;
      color: string | null;
    }>,
  ) => request<void>(`/api/playlists/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),

  deletePlaylist: (id: number) => request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),

  getTracks: (
    params: { status?: TrackStatus; q?: string; limit?: number; offset?: number } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.q) search.set('q', params.q);
    search.set('limit', String(params.limit ?? 5000));
    search.set('offset', String(params.offset ?? 0));
    return request<TracksListResponse>(`/api/tracks?${search.toString()}`);
  },

  assignTrack: (uri: string, playlistId: number) =>
    request<void>(`/api/tracks/${encodeURIComponent(uri)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ playlistId }),
    }),

  unassignTrack: (uri: string, playlistId: number) =>
    request<void>(`/api/tracks/${encodeURIComponent(uri)}/unassign`, {
      method: 'POST',
      body: JSON.stringify({ playlistId }),
    }),

  setTrackStatus: (uri: string, status: TrackStatus) =>
    request<void>(`/api/tracks/${encodeURIComponent(uri)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  bulkAssign: (uris: string[], playlistId: number) =>
    request<void>('/api/tracks/bulk/assign', {
      method: 'POST',
      body: JSON.stringify({ uris, playlistId }),
    }),

  bulkUnassign: (uris: string[], playlistId: number) =>
    request<void>('/api/tracks/bulk/unassign', {
      method: 'POST',
      body: JSON.stringify({ uris, playlistId }),
    }),

  getTrackSuggestions: (uri: string) =>
    request<PlaylistSuggestion[]>(`/api/tracks/${encodeURIComponent(uri)}/suggestions`),

  getPlaylistSuggestions: (id: number, limit = 50) =>
    request<TrackSuggestion[]>(`/api/playlists/${id}/suggestions?limit=${limit}`),

  getRecipe: (id: number) => request<Recipe>(`/api/playlists/${id}/recipe`),

  putRecipe: (id: number, recipe: Omit<Recipe, 'playlistId'>) =>
    request<Recipe>(`/api/playlists/${id}/recipe`, { method: 'PUT', body: JSON.stringify(recipe) }),

  playTrack: (uri: string) =>
    request<void>(`/api/tracks/${encodeURIComponent(uri)}/play`, { method: 'POST' }),
};

export { ApiError };
