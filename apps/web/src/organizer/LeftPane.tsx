import { useState } from 'react';
import type { PlaylistView, StatusCounts, TrackStatus } from '../lib/api';

type PlaylistSelection = number | 'main' | 'archive' | null;

interface LeftPaneProps {
  statusCounts: StatusCounts;
  statusFilter: TrackStatus | null;
  onStatusFilterChange: (status: TrackStatus | null) => void;
  playlists: PlaylistView[];
  selectedPlaylistId: PlaylistSelection;
  onSelectPlaylist: (id: PlaylistSelection) => void;
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist: (id: number) => void;
  onEditRecipe: (id: number) => void;
}

const STATUS_TABS: { key: TrackStatus; label: string }[] = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'organized', label: 'Organized' },
  { key: 'skipped', label: 'Skipped' },
];

export function LeftPane({
  statusCounts,
  statusFilter,
  onStatusFilterChange,
  playlists,
  selectedPlaylistId,
  onSelectPlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
  onEditRecipe,
}: LeftPaneProps) {
  const [newName, setNewName] = useState('');
  const subPlaylists = playlists.filter((p) => p.kind === 'sub');
  const mainPlaylist = playlists.find((p) => p.kind === 'main');
  const archivePlaylist = playlists.find((p) => p.kind === 'archive');

  return (
    <div className="flex h-full min-h-0 w-64 shrink-0 flex-col gap-4 border-r border-zinc-800 bg-zinc-950 p-3 text-sm">
      <div className="space-y-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onStatusFilterChange(statusFilter === tab.key ? null : tab.key)}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${
              statusFilter === tab.key
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-300 hover:bg-zinc-900'
            }`}
          >
            <span>{tab.label}</span>
            <span className="text-zinc-400">{statusCounts[tab.key]}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Library
        </div>
        <div className="mb-3 space-y-0.5">
          {mainPlaylist && (
            <button
              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${
                selectedPlaylistId === 'main'
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-300 hover:bg-zinc-900'
              }`}
              onClick={() => onSelectPlaylist('main')}
            >
              <span className="truncate">{mainPlaylist.name}</span>
              <span className="ml-auto shrink-0 text-zinc-400">{mainPlaylist.trackCount}</span>
            </button>
          )}
          {archivePlaylist && (
            <button
              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${
                selectedPlaylistId === 'archive'
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-300 hover:bg-zinc-900'
              }`}
              onClick={() => onSelectPlaylist('archive')}
            >
              <span className="truncate">{archivePlaylist.name}</span>
              <span className="ml-auto shrink-0 text-zinc-400">{archivePlaylist.trackCount}</span>
            </button>
          )}
        </div>

        <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Playlists
        </div>
        <div className="space-y-0.5">
          {subPlaylists.map((p) => (
            <div
              key={p.id}
              className={`group flex items-center justify-between rounded px-2 py-1.5 ${
                selectedPlaylistId === p.id
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => onSelectPlaylist(selectedPlaylistId === p.id ? null : p.id)}
              >
                {p.emoji && <span>{p.emoji}</span>}
                <span className="truncate">{p.name}</span>
                <span className="ml-auto shrink-0 text-zinc-400">{p.trackCount}</span>
              </button>
              <div className="ml-1 hidden shrink-0 gap-1 group-hover:flex">
                <button
                  title="Edit recipe"
                  onClick={() => onEditRecipe(p.id)}
                  className="rounded px-1 text-zinc-400 hover:text-white"
                >
                  ⚙
                </button>
                <button
                  title="Delete playlist"
                  onClick={() => {
                    if (
                      confirm(`Delete "${p.name}"? Songs stay in your library, just unassigned.`)
                    ) {
                      onDeletePlaylist(p.id);
                    }
                  }}
                  className="rounded px-1 text-zinc-400 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <form
        className="flex gap-1"
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
          className="w-full min-w-0 rounded bg-zinc-900 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          className="shrink-0 rounded bg-zinc-700 px-2 py-1 text-sm hover:bg-zinc-600"
        >
          +
        </button>
      </form>
    </div>
  );
}
