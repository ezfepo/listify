import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';

interface AutoSortPanelProps {
  playlistId: number;
  playlistName: string;
  onBulkAssign: (uris: string[], playlistId: number) => void;
}

export function AutoSortPanel({ playlistId, playlistName, onBulkAssign }: AutoSortPanelProps) {
  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ['playlist-suggestions', playlistId],
    queryFn: () => api.getPlaylistSuggestions(playlistId, 100),
  });
  const [checked, setChecked] = useState<Set<string>>(new Set());

  function toggle(uri: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  }

  return (
    <div className="flex min-h-0 w-80 flex-1 flex-col border-l border-zinc-800 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">Auto-sort: {playlistName}</h3>
        <button
          onClick={() => setChecked(new Set(suggestions.map((s) => s.uri)))}
          className="text-xs text-zinc-400 hover:text-white"
        >
          Select all
        </button>
      </div>

      {isLoading && <p className="text-zinc-500">Scoring candidates…</p>}
      {!isLoading && suggestions.length === 0 && (
        <p className="text-zinc-500">
          No unassigned candidates score above 0 for this playlist's recipe yet.
        </p>
      )}

      <div className="flex-1 space-y-1 overflow-y-auto">
        {suggestions.map((s) => (
          <label
            key={s.uri}
            className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-zinc-900"
          >
            <input
              type="checkbox"
              checked={checked.has(s.uri)}
              onChange={() => toggle(s.uri)}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate">{s.name}</div>
              <div className="truncate text-xs text-zinc-500">
                {s.artists} · {s.score} · {s.reason}
              </div>
            </div>
          </label>
        ))}
      </div>

      <button
        disabled={checked.size === 0}
        onClick={() => {
          onBulkAssign([...checked], playlistId);
          setChecked(new Set());
        }}
        className="mt-2 rounded bg-green-600 px-2 py-1.5 disabled:opacity-40"
      >
        Assign {checked.size > 0 ? checked.size : ''} to {playlistName}
      </button>
    </div>
  );
}
