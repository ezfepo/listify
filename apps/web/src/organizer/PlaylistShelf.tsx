import { useState } from 'react';
import type { PlaylistView } from '../lib/api';

export type PlaylistSelection = number | 'main' | 'archive' | null;

interface PlaylistShelfProps {
  playlists: PlaylistView[];
  selectedPlaylistId: PlaylistSelection;
  onSelectPlaylist: (id: PlaylistSelection) => void;
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist: (id: number) => void;
  onEditRecipe: (id: number) => void;
}

function tileClass(selected: boolean): string {
  return `rounded-lg border px-3 py-2 text-left ${
    selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-raise'
  }`;
}

/** Horizontal shelf of playlist tiles. Main and Archive are read-only entries. */
export function PlaylistShelf({
  playlists,
  selectedPlaylistId,
  onSelectPlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
  onEditRecipe,
}: PlaylistShelfProps) {
  const [newName, setNewName] = useState('');
  const subPlaylists = playlists.filter((p) => p.kind === 'sub');
  const mainPlaylist = playlists.find((p) => p.kind === 'main');
  const archivePlaylist = playlists.find((p) => p.kind === 'archive');

  return (
    <div
      className="flex items-stretch gap-2 overflow-x-auto pb-1"
      aria-label="Playlists"
      role="group"
    >
      {[
        { sel: 'main' as const, playlist: mainPlaylist },
        { sel: 'archive' as const, playlist: archivePlaylist },
      ].map(
        ({ sel, playlist }) =>
          playlist && (
            <button
              key={sel}
              aria-pressed={selectedPlaylistId === sel}
              className={`${tileClass(selectedPlaylistId === sel)} shrink-0`}
              onClick={() => onSelectPlaylist(sel)}
            >
              <span className="block truncate text-sm font-medium">{playlist.name}</span>
              <span className="font-mono text-xs tabular-nums text-muted">
                {playlist.trackCount}
              </span>
            </button>
          ),
      )}

      {subPlaylists.map((p) => (
        <div key={p.id} className={`${tileClass(selectedPlaylistId === p.id)} flex shrink-0 gap-2`}>
          <button
            aria-pressed={selectedPlaylistId === p.id}
            className="min-w-0 text-left"
            onClick={() => onSelectPlaylist(selectedPlaylistId === p.id ? null : p.id)}
          >
            <span className="block max-w-40 truncate text-sm font-medium">
              {p.emoji && <span className="mr-1">{p.emoji}</span>}
              {p.name}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted">{p.trackCount}</span>
          </button>
          <div className="flex flex-col justify-between text-muted">
            <button
              title="Edit recipe"
              onClick={() => onEditRecipe(p.id)}
              className="rounded px-1 leading-none hover:text-ink"
            >
              ⚙
            </button>
            <button
              title="Delete playlist"
              onClick={() => {
                if (confirm(`Delete "${p.name}"? Songs stay in your library, just unassigned.`)) {
                  onDeletePlaylist(p.id);
                }
              }}
              className="rounded px-1 leading-none hover:text-danger"
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      <form
        className="flex shrink-0 items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          onCreatePlaylist(newName.trim());
          setNewName('');
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New playlist…"
          aria-label="New playlist name"
          className="w-36 rounded border border-line bg-surface px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          aria-label="Create playlist"
          className="rounded bg-accent px-2.5 py-1.5 text-sm text-white hover:opacity-90"
        >
          +
        </button>
      </form>
    </div>
  );
}
