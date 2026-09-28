import { useVirtualizer } from '@tanstack/react-virtual';
import { forwardRef, useMemo, useRef, useState } from 'react';
import { FEATURE_KEYS, type FeatureKey, type PlaylistView, type TrackView } from '../lib/api';

type SortKey = FeatureKey | 'name';

const FEATURE_ABBREVIATIONS: Record<FeatureKey, string> = {
  valence: 'val',
  energy: 'nrg',
  danceability: 'dnc',
  tempo: 'bpm',
  acousticness: 'aco',
  instrumentalness: 'ins',
  speechiness: 'spc',
  loudness: 'db',
};

interface CenterTableProps {
  tracks: TrackView[];
  selection: Set<string>;
  onToggleSelect: (uri: string) => void;
  onClearSelection: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  playlists: PlaylistView[];
  onAssign: (uri: string, playlistId: number) => void;
  onUnassign: (uri: string, playlistId: number) => void;
  onBulkAssign: (uris: string[], playlistId: number) => void;
  onBulkUnassign: (uris: string[], playlistId: number) => void;
  onSetStatus: (uri: string, status: 'inbox' | 'organized' | 'skipped') => void;
  onPlay: (uri: string) => void;
  onFocusTrack: (uri: string) => void;
}

const ROW_HEIGHT = 44;

export const CenterTable = forwardRef<HTMLInputElement, CenterTableProps>(function CenterTable(
  {
    tracks,
    selection,
    onToggleSelect,
    onClearSelection,
    search,
    onSearchChange,
    playlists,
    onAssign,
    onUnassign,
    onBulkAssign,
    onBulkUnassign,
    onSetStatus,
    onPlay,
    onFocusTrack,
  },
  searchInputRef,
) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const [bulkTargetId, setBulkTargetId] = useState<number | null>(null);
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

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  }

  function sortIndicator(key: SortKey) {
    if (!sort || sort.key !== key) return '';
    return sort.dir === 'desc' ? ' ▾' : ' ▴';
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 p-2">
        <input
          ref={searchInputRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search name or artist… ( / )"
          className="w-64 rounded bg-zinc-900 px-2 py-1 text-sm"
        />
        {selection.size > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-400">{selection.size} selected</span>
            <select
              value={bulkTargetId ?? ''}
              onChange={(e) => setBulkTargetId(e.target.value ? Number(e.target.value) : null)}
              className="rounded bg-zinc-900 px-2 py-1 text-xs"
            >
              <option value="">Playlist…</option>
              {subPlaylists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              disabled={!bulkTargetId}
              onClick={() => {
                if (!bulkTargetId) return;
                onBulkAssign([...selection], bulkTargetId);
                setBulkTargetId(null);
              }}
              className="rounded bg-green-600 px-2 py-1 disabled:opacity-40"
              title={bulkTargetId ? undefined : 'Pick a playlist first'}
            >
              Assign
            </button>
            <button
              disabled={!bulkTargetId}
              onClick={() => {
                if (!bulkTargetId) return;
                onBulkUnassign([...selection], bulkTargetId);
                setBulkTargetId(null);
              }}
              className="rounded bg-zinc-700 px-2 py-1 disabled:opacity-40"
              title={bulkTargetId ? undefined : 'Pick a playlist first'}
            >
              Unassign
            </button>
            <button
              onClick={() => {
                for (const uri of selection) onSetStatus(uri, 'skipped');
                onClearSelection();
              }}
              className="rounded bg-zinc-700 px-2 py-1"
            >
              Skip
            </button>
            <button onClick={onClearSelection} className="rounded bg-zinc-800 px-2 py-1">
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-zinc-800 px-2 py-1 text-xs text-zinc-400">
        <button
          className="w-40 shrink-0 text-left hover:text-white"
          onClick={() => toggleSort('name')}
        >
          Title / Artist{sortIndicator('name')}
        </button>
        <span className="w-28 shrink-0">Playlists</span>
        {FEATURE_KEYS.map((key) => (
          <button
            key={key}
            className="w-12 shrink-0 text-left hover:text-white"
            title={key}
            onClick={() => toggleSort(key)}
          >
            {FEATURE_ABBREVIATIONS[key]}
            {sortIndicator(key)}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const track = sorted[virtualRow.index];
            if (!track) return null;
            const selected = selection.has(track.uri);
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
                className={`flex items-center gap-1 border-b border-zinc-900 px-2 text-sm ${
                  selected ? 'bg-zinc-800' : 'hover:bg-zinc-900'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect(track.uri)}
                  className="shrink-0"
                />
                <button
                  onClick={() => onFocusTrack(track.uri)}
                  title="View in Triage"
                  className="w-40 shrink-0 truncate text-left hover:text-white"
                >
                  <div className="truncate">{track.name}</div>
                  <div className="truncate text-xs text-zinc-500">{track.artists}</div>
                </button>
                <div className="flex w-28 shrink-0 flex-wrap gap-1">
                  {track.playlists.map((p) => (
                    <span
                      key={p.id}
                      onClick={() => onUnassign(track.uri, p.id)}
                      title="Click to unassign"
                      className="cursor-pointer rounded bg-zinc-700 px-1 text-xs hover:bg-red-900"
                    >
                      {p.name}
                    </span>
                  ))}
                </div>
                {FEATURE_KEYS.map((key) => (
                  <span key={key} className="w-12 shrink-0 truncate text-xs text-zinc-400">
                    {track.features?.[key] !== undefined ? track.features[key]!.toFixed(2) : '—'}
                  </span>
                ))}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      if (id) onAssign(track.uri, id);
                      e.target.value = '';
                    }}
                    className="rounded bg-zinc-900 px-1 py-0.5 text-xs"
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
                    onClick={() => onPlay(track.uri)}
                    title="Play on active device"
                    className="px-1 text-xs"
                  >
                    ▶
                  </button>
                  <a
                    href={track.uri}
                    title="Open in Spotify"
                    className="px-1 text-xs text-green-400 hover:text-green-300"
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
  );
});
