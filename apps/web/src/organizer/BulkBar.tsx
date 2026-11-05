import { useState } from 'react';
import type { PlaylistView, TrackStatus } from '../lib/api';

interface BulkBarProps {
  selection: Set<string>;
  playlists: PlaylistView[];
  onBulkAssign: (uris: string[], playlistId: number) => void;
  onBulkUnassign: (uris: string[], playlistId: number) => void;
  onSetStatus: (uri: string, status: TrackStatus) => void;
  onClearSelection: () => void;
}

/** Floating bar shown while songs are selected. */
export function BulkBar({
  selection,
  playlists,
  onBulkAssign,
  onBulkUnassign,
  onSetStatus,
  onClearSelection,
}: BulkBarProps) {
  const [targetId, setTargetId] = useState<number | null>(null);
  if (selection.size === 0) return null;
  const subPlaylists = playlists.filter((p) => p.kind === 'sub');
  const button = 'rounded px-3 py-1.5 text-sm disabled:opacity-40';

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="fixed bottom-4 left-1/2 z-20 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 shadow-lg"
    >
      <span className="font-mono text-sm tabular-nums">{selection.size} selected</span>
      <span className="text-sm text-muted">assign to</span>
      <select
        aria-label="Target playlist"
        value={targetId ?? ''}
        onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
        className="rounded border border-line bg-surface px-2 py-1.5 text-sm"
      >
        <option value="">Playlist…</option>
        {subPlaylists.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        disabled={!targetId}
        onClick={() => {
          if (!targetId) return;
          onBulkAssign([...selection], targetId);
          setTargetId(null);
        }}
        className={`${button} bg-accent text-white`}
        title={targetId ? undefined : 'Pick a playlist first'}
      >
        Assign
      </button>
      <button
        disabled={!targetId}
        onClick={() => {
          if (!targetId) return;
          onBulkUnassign([...selection], targetId);
          setTargetId(null);
        }}
        className={`${button} bg-raise`}
        title={targetId ? undefined : 'Pick a playlist first'}
      >
        Unassign
      </button>
      <button
        onClick={() => {
          for (const uri of selection) onSetStatus(uri, 'skipped');
          onClearSelection();
        }}
        className={`${button} bg-raise`}
      >
        Skip
      </button>
      <button
        onClick={() => {
          for (const uri of selection) onSetStatus(uri, 'inbox');
          onClearSelection();
        }}
        title="Unassign from everything and send back to Inbox"
        className={`${button} bg-raise`}
      >
        Reset
      </button>
      <button onClick={onClearSelection} className={`${button} text-muted hover:text-ink`}>
        Clear
      </button>
    </div>
  );
}
