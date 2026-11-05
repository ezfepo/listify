import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, formatDuration, type FeatureKey, type TrackView } from '../lib/api';
import { Chip } from '../ui';

export type ColumnKey =
  | 'album'
  | 'playlists'
  | 'suggested'
  | 'energy'
  | 'tempo'
  | 'time'
  | 'valence'
  | 'danceability'
  | 'acousticness'
  | 'instrumentalness'
  | 'speechiness'
  | 'loudness'
  | 'tags'
  | 'added'
  | 'status';

export interface ColumnContext {
  onUnassign: (uri: string, playlistId: number) => void;
}

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  title?: string;
  /** Minimum width in rem; the grid track is `minmax(minRem, flex fr)`. */
  minRem: number;
  flex: number;
  defaultOn: boolean;
  cell: (track: TrackView, ctx: ColumnContext) => ReactNode;
}

const MONO = 'font-mono text-xs tabular-nums text-muted';

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

function feature(
  key: FeatureKey,
  label: string,
  format: (value: number) => string,
  defaultOn = false,
  title?: string,
): ColumnDef {
  return {
    key,
    label,
    title,
    minRem: 3.5,
    flex: 0,
    defaultOn,
    cell: (t) => (
      <span className={MONO}>
        {t.features?.[key] !== undefined ? format(t.features[key]!) : '—'}
      </span>
    ),
  };
}

const two = (v: number) => v.toFixed(2);

const STATUS_TONE = { inbox: 'accent', organized: 'done', skipped: 'neutral' } as const;
const STATUS_LABEL = { inbox: 'Inbox', organized: 'Organized', skipped: 'Skipped' } as const;

/** Optional columns, in display order. Fixed ones (select, cover, title, actions) live in CenterTable. */
export const COLUMN_DEFS: ColumnDef[] = [
  {
    key: 'album',
    label: 'Album',
    minRem: 7,
    flex: 1,
    defaultOn: true,
    cell: (t) => <span className="truncate text-xs text-muted">{t.album ?? '—'}</span>,
  },
  {
    key: 'playlists',
    label: 'Playlists',
    minRem: 8,
    flex: 1.5,
    defaultOn: true,
    cell: (t, ctx) => (
      <div className="flex flex-wrap gap-1 overflow-hidden">
        {t.playlists.map((p) => (
          <button
            key={p.id}
            onClick={() => ctx.onUnassign(t.uri, p.id)}
            title="Click to unassign"
            className="rounded-full bg-raise px-2 text-xs hover:bg-danger hover:text-white"
          >
            {p.name}
          </button>
        ))}
      </div>
    ),
  },
  {
    key: 'suggested',
    label: 'Suggested',
    minRem: 7,
    flex: 1,
    defaultOn: true,
    cell: (t) => <SuggestedCell track={t} />,
  },
  feature('energy', 'Energy', two, true),
  feature('tempo', 'BPM', (v) => String(Math.round(v)), true, 'Tempo (beats per minute)'),
  {
    key: 'time',
    label: 'Time',
    minRem: 3.5,
    flex: 0,
    defaultOn: true,
    cell: (t) => <span className={MONO}>{formatDuration(t.durationMs)}</span>,
  },
  feature('valence', 'Valence', two),
  feature('danceability', 'Dance', two, false, 'Danceability'),
  feature('acousticness', 'Acoustic', two, false, 'Acousticness'),
  feature('instrumentalness', 'Instr.', two, false, 'Instrumentalness'),
  feature('speechiness', 'Speech', two, false, 'Speechiness'),
  feature('loudness', 'Loudness', (v) => `${v.toFixed(1)} dB`),
  {
    key: 'tags',
    label: 'Tags',
    minRem: 8,
    flex: 1.5,
    defaultOn: false,
    cell: (t) => {
      const unique = [...new Set(t.tags.map((x) => x.tag))].slice(0, 3);
      return unique.length === 0 ? (
        <span className="text-xs text-muted">—</span>
      ) : (
        <div className="flex flex-wrap gap-1 overflow-hidden">
          {unique.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      );
    },
  },
  {
    key: 'added',
    label: 'Added',
    minRem: 6,
    flex: 0,
    defaultOn: false,
    cell: (t) => <span className={MONO}>{t.addedAt ? t.addedAt.slice(0, 10) : '—'}</span>,
  },
  {
    key: 'status',
    label: 'Status',
    minRem: 6,
    flex: 0,
    defaultOn: false,
    cell: (t) => <Chip tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Chip>,
  },
];

export const DEFAULT_COLUMNS: ColumnKey[] = COLUMN_DEFS.filter((c) => c.defaultOn).map(
  (c) => c.key,
);

const STORAGE_KEY = 'listify.columns';

export function loadColumns(): ColumnKey[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_COLUMNS;
    const known = new Set<string>(COLUMN_DEFS.map((c) => c.key));
    return parsed.filter((k): k is ColumnKey => typeof k === 'string' && known.has(k));
  } catch {
    return DEFAULT_COLUMNS;
  }
}

export function saveColumns(keys: ColumnKey[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // storage unavailable (private mode, quota): the choice just won't persist
  }
}

/** CSS grid template + minimum table width for the fixed columns plus the chosen ones. */
export function gridLayout(defs: ColumnDef[]): { template: string; minWidthRem: number } {
  const fixedStart = ['1.5rem', '2rem', 'minmax(11rem,2fr)'];
  const fixedEnd = ['10rem'];
  const middle = defs.map((d) =>
    d.flex > 0 ? `minmax(${d.minRem}rem,${d.flex}fr)` : `${d.minRem}rem`,
  );
  const tracks = [...fixedStart, ...middle, ...fixedEnd];
  const gaps = (tracks.length - 1) * 0.5 + 1;
  const minWidthRem = 1.5 + 2 + 11 + 10 + defs.reduce((sum, d) => sum + d.minRem, 0) + gaps;
  return { template: tracks.join(' '), minWidthRem };
}
