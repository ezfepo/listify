import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { forwardRef, useMemo, useRef, useState } from 'react';
import {
  api,
  FEATURE_KEYS,
  formatDuration,
  type FeatureKey,
  type PlaylistView,
  type StatusCounts,
  type TrackStatus,
  type TrackView,
} from '../lib/api';
import { Chip } from '../ui';

type SortKey = FeatureKey | 'name';
type SortState = { key: SortKey; dir: 'asc' | 'desc' };

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Title',
  valence: 'Valence',
  energy: 'Energy',
  danceability: 'Danceability',
  tempo: 'Tempo (bpm)',
  acousticness: 'Acousticness',
  instrumentalness: 'Instrumentalness',
  speechiness: 'Speechiness',
  loudness: 'Loudness',
};

const STATUS_OPTIONS: { key: TrackStatus | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'organized', label: 'Organized' },
  { key: 'skipped', label: 'Skipped' },
];

interface CenterTableProps {
  tracks: TrackView[];
  statusCounts: StatusCounts;
  statusFilter: TrackStatus | null;
  onStatusFilterChange: (status: TrackStatus | null) => void;
  selection: Set<string>;
  onToggleSelect: (uri: string) => void;
  onClearSelection: () => void;
  onSelectAll: (uris: string[]) => void;
  search: string;
  onSearchChange: (value: string) => void;
  playlists: PlaylistView[];
  focusedUri: string | null;
  onAssign: (uri: string, playlistId: number) => void;
  onUnassign: (uri: string, playlistId: number) => void;
  onSetStatus: (uri: string, status: TrackStatus) => void;
  onPlay: (uri: string) => void;
  onFocusTrack: (uri: string) => void;
}

const ROW_HEIGHT = 48;
const COLUMNS =
  'grid grid-cols-[1.5rem_2rem_minmax(11rem,2fr)_minmax(7rem,1fr)_minmax(8rem,1.5fr)_minmax(7rem,1fr)_3.5rem_3.5rem_3.5rem_10rem] items-center gap-2';

function SuggestedCell({ track }: { track: TrackView }) {
  const { data = [] } = useQuery({
    queryKey: ['suggestions', track.uri],
    queryFn: () => api.getTrackSuggestions(track.uri),
    staleTime: 60_000,
  });
  const assigned = new Set(track.playlists.map((p) => p.id));
  const best = data.find((s) => s.score > 0 && !assigned.has(s.playlistId));
  if (!best) return <span className="text-xs text-muted">—</span>;
  return (
    <Chip tone="accent" className="max-w-full truncate">
      {best.playlistName} {best.score}
    </Chip>
  );
}

export const CenterTable = forwardRef<HTMLInputElement, CenterTableProps>(function CenterTable(
  {
    tracks,
    statusCounts,
    statusFilter,
    onStatusFilterChange,
    selection,
    onToggleSelect,
    onClearSelection,
    onSelectAll,
    search,
    onSearchChange,
    playlists,
    focusedUri,
    onAssign,
    onUnassign,
    onSetStatus,
    onPlay,
    onFocusTrack,
  },
  searchInputRef,
) {
  const [sort, setSort] = useState<SortState | null>(null);
  const subPlaylists = playlists.filter((p) => p.kind === 'sub');
  const scrollRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => {
    if (!sort) return tracks;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...tracks].sort((a, b) => {
      if (sort.key === 'name') return factor * a.name.localeCompare(b.name);
      const av = a.features?.[sort.key];
      const bv = b.features?.[sort.key];
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return factor * (av - bv);
    });
  }, [tracks, sort]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  function chooseSort(value: string) {
    if (!value) setSort(null);
    else {
      const key = value as SortKey;
      setSort({ key, dir: key === 'name' ? 'asc' : 'desc' });
    }
  }

  const allSelected = sorted.length > 0 && sorted.every((t) => selection.has(t.uri));

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
        <div role="group" aria-label="Status" className="flex rounded-lg bg-raise p-0.5 text-sm">
          {STATUS_OPTIONS.map((opt) => {
            const active = statusFilter === opt.key;
            return (
              <button
                key={opt.label}
                aria-pressed={active}
                onClick={() => onStatusFilterChange(opt.key)}
                className={`rounded-md px-3 py-1 ${active ? 'bg-surface font-medium shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {opt.label}
                {opt.key && (
                  <span className="ml-1 font-mono text-xs tabular-nums text-muted">
                    {statusCounts[opt.key]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <input
          ref={searchInputRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search name or artist… ( / )"
          aria-label="Search"
          className="w-64 min-w-0 rounded border border-line bg-surface px-2 py-1.5 text-sm"
        />
        <div className="ml-auto flex items-center gap-1 text-sm">
          <label className="text-muted" htmlFor="sort-key">
            Sort
          </label>
          <select
            id="sort-key"
            value={sort?.key ?? ''}
            onChange={(e) => chooseSort(e.target.value)}
            className="rounded border border-line bg-surface px-2 py-1.5"
          >
            <option value="">Default order</option>
            <option value="name">{SORT_LABELS.name}</option>
            {FEATURE_KEYS.map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <button
            disabled={!sort}
            onClick={() =>
              setSort((s) => (s ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s))
            }
            aria-label={
              sort
                ? `Sort direction: ${sort.dir === 'asc' ? 'ascending' : 'descending'}`
                : 'Sort direction'
            }
            className="rounded border border-line px-2 py-1.5 disabled:opacity-40"
          >
            {sort?.dir === 'asc' ? '▴' : '▾'}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="overflow-auto"
        style={{ height: 'max(20rem, calc(100vh - 22rem))' }}
      >
        <div className="min-w-[56rem]">
          <div
            className={`${COLUMNS} sticky top-0 z-10 border-b border-line bg-surface px-2 py-1.5 text-xs text-muted`}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selection.size > 0 && !allSelected;
              }}
              onChange={(e) => {
                if (e.target.checked) onSelectAll(sorted.map((t) => t.uri));
                else onClearSelection();
              }}
              title="Select all"
            />
            <span />
            <span>Title / Artist</span>
            <span>Album</span>
            <span>Playlists</span>
            <span>Suggested</span>
            <span title="valence / energy">Energy</span>
            <span>BPM</span>
            <span>Time</span>
            <span />
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const track = sorted[virtualRow.index];
              if (!track) return null;
              const selected = selection.has(track.uri);
              const focused = focusedUri === track.uri;
              return (
                <div
                  key={track.uri}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={`${COLUMNS} border-b border-line px-2 text-sm ${
                    selected ? 'bg-accent-soft' : focused ? 'bg-raise' : 'hover:bg-ground'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleSelect(track.uri)}
                    aria-label={`Select ${track.name}`}
                  />
                  {track.imageUrl ? (
                    <img src={track.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-raise text-xs">
                      🎵
                    </div>
                  )}
                  <button
                    onClick={() => onFocusTrack(track.uri)}
                    title="Inspect song"
                    className="min-w-0 text-left"
                  >
                    <div className="truncate">{track.name}</div>
                    <div className="truncate text-xs text-muted">{track.artists}</div>
                  </button>
                  <span className="truncate text-xs text-muted">{track.album ?? '—'}</span>
                  <div className="flex flex-wrap gap-1 overflow-hidden">
                    {track.playlists.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => onUnassign(track.uri, p.id)}
                        title="Click to unassign"
                        className="rounded-full bg-raise px-2 text-xs hover:bg-danger hover:text-white"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <SuggestedCell track={track} />
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {track.features?.energy !== undefined ? track.features.energy.toFixed(2) : '—'}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {track.features?.tempo !== undefined ? Math.round(track.features.tempo) : '—'}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {formatDuration(track.durationMs)}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <select
                      defaultValue=""
                      aria-label={`Add ${track.name} to a playlist`}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        if (id) onAssign(track.uri, id);
                        e.target.value = '';
                      }}
                      className="w-24 rounded border border-line bg-surface px-1 py-0.5 text-xs"
                    >
                      <option value="" disabled>
                        + Add to…
                      </option>
                      {subPlaylists.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => onSetStatus(track.uri, 'inbox')}
                      title="Reset: unassign from everything and send back to Inbox"
                      className="px-1 text-xs hover:text-accent"
                    >
                      ↺
                    </button>
                    <button
                      onClick={() => onPlay(track.uri)}
                      title="Play on active device"
                      className="px-1 text-xs hover:text-accent"
                    >
                      ▶
                    </button>
                    <a
                      href={track.uri}
                      title="Open in Spotify"
                      className="px-1 text-xs text-accent hover:underline"
                    >
                      ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
