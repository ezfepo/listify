import { useVirtualizer } from '@tanstack/react-virtual';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  FEATURE_KEYS,
  type FeatureKey,
  type PlaylistView,
  type StatusCounts,
  type TrackStatus,
  type TrackView,
} from '../lib/api';
import { COLUMN_DEFS, gridLayout, loadColumns, saveColumns, type ColumnKey } from './columns';

type SortKey = FeatureKey | 'name' | 'duration' | 'added';
type SortState = { key: SortKey; dir: 'asc' | 'desc' };

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Title',
  duration: 'Time',
  added: 'Date added',
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
const ROW_CLASS = 'grid items-center gap-2';

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
  const [columnKeys, setColumnKeys] = useState<ColumnKey[]>(loadColumns);
  useEffect(() => saveColumns(columnKeys), [columnKeys]);
  const activeColumns = COLUMN_DEFS.filter((c) => columnKeys.includes(c.key));
  const layout = gridLayout(activeColumns);
  const columnCtx = { onUnassign };
  const columnsMenuRef = useRef<HTMLDetailsElement>(null);
  // Close the Columns menu on an outside click or Escape.
  useEffect(() => {
    function close(e: Event) {
      const menu = columnsMenuRef.current;
      if (!menu?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.contains(e.target as Node)) {
        menu.open = false;
      }
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  function toggleColumn(key: ColumnKey) {
    setColumnKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }
  const subPlaylists = playlists.filter((p) => p.kind === 'sub');
  const scrollRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => {
    if (!sort) return tracks;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...tracks].sort((a, b) => {
      if (sort.key === 'name') return factor * a.name.localeCompare(b.name);
      const sortKey = sort.key;
      const value = (t: TrackView): number | undefined =>
        sortKey === 'duration'
          ? (t.durationMs ?? undefined)
          : sortKey === 'added'
            ? t.addedAt
              ? Date.parse(t.addedAt)
              : undefined
            : t.features?.[sortKey];
      const av = value(a);
      const bv = value(b);
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
        <details ref={columnsMenuRef} className="relative text-sm">
          <summary className="cursor-pointer list-none rounded border border-line px-2 py-1.5">
            Columns
          </summary>
          <div className="absolute left-0 z-20 mt-1 grid w-56 gap-1 rounded-lg border border-line bg-surface p-2 shadow-lg">
            {COLUMN_DEFS.map((c) => (
              <label key={c.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={columnKeys.includes(c.key)}
                  onChange={() => toggleColumn(c.key)}
                />
                {c.title ?? c.label}
              </label>
            ))}
          </div>
        </details>
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
            <option value="duration">{SORT_LABELS.duration}</option>
            <option value="added">{SORT_LABELS.added}</option>
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
        role="region"
        aria-label="Songs"
        tabIndex={0}
        className="overflow-auto"
        style={{ height: 'max(20rem, calc(100vh - 22rem))' }}
      >
        <div style={{ minWidth: `${layout.minWidthRem}rem` }}>
          <div
            style={{ gridTemplateColumns: layout.template }}
            className={`${ROW_CLASS} sticky top-0 z-10 border-b border-line bg-surface px-2 py-1.5 text-xs text-muted`}
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
            {activeColumns.map((c) => (
              <span key={c.key} title={c.title}>
                {c.label}
              </span>
            ))}
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
                    gridTemplateColumns: layout.template,
                  }}
                  className={`${ROW_CLASS} border-b border-line px-2 text-sm ${
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
                  {activeColumns.map((c) => (
                    <div key={c.key} className="min-w-0">
                      {c.cell(track, columnCtx)}
                    </div>
                  ))}
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
