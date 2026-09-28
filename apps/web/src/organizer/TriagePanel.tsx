import { useEffect, useState } from 'react';
import { api, type PlaylistSuggestion, type PlaylistView, type TrackView } from '../lib/api';

interface TriagePanelProps {
  track: TrackView | undefined;
  queueLength: number;
  playlists: PlaylistView[];
  onAssign: (uri: string, playlistId: number) => void;
  onSkip: (uri: string) => void;
  onDone: () => void;
  onPlay: (uri: string) => void;
  registerHotkeys: (handlers: TriageHotkeys | null) => void;
}

export interface TriageHotkeys {
  togglePlaylist: (index: number) => void;
  acceptSuggestions: () => void;
  openInSpotify: () => void;
  play: () => void;
  markDone: () => void;
  skip: () => void;
}

const SUGGESTION_THRESHOLD = 60;

export function TriagePanel({
  track,
  queueLength,
  playlists,
  onAssign,
  onSkip,
  onDone,
  onPlay,
  registerHotkeys,
}: TriagePanelProps) {
  const [suggestions, setSuggestions] = useState<PlaylistSuggestion[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<number>>(new Set());
  const subPlaylists = playlists.filter((p) => p.kind === 'sub');

  useEffect(() => {
    setAssignedIds(new Set());
    if (!track) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    api.getTrackSuggestions(track.uri).then((result) => {
      if (!cancelled) setSuggestions(result);
    });
    return () => {
      cancelled = true;
    };
  }, [track?.uri]);

  const numbered = suggestions.slice(0, 9);

  function toggle(playlistId: number) {
    if (!track) return;
    onAssign(track.uri, playlistId);
    setAssignedIds((prev) => new Set(prev).add(playlistId));
  }

  useEffect(() => {
    if (!track) {
      registerHotkeys(null);
      return;
    }
    registerHotkeys({
      togglePlaylist: (index) => {
        const suggestion = numbered[index];
        if (suggestion) toggle(suggestion.playlistId);
      },
      acceptSuggestions: () => {
        for (const s of numbered) {
          if (s.score >= SUGGESTION_THRESHOLD) toggle(s.playlistId);
        }
      },
      openInSpotify: () => window.open(track.uri, '_blank'),
      play: () => onPlay(track.uri),
      markDone: () => onDone(),
      skip: () => onSkip(track.uri),
    });
    return () => registerHotkeys(null);
  }, [track, numbered, onAssign, onDone, onPlay, onSkip, registerHotkeys]);

  if (!track) {
    return (
      <div className="flex h-full w-80 shrink-0 flex-col items-center justify-center border-l border-zinc-800 p-4 text-center text-sm text-zinc-500">
        Inbox is empty — nothing left to triage.
      </div>
    );
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col gap-3 border-l border-zinc-800 p-4">
      <div className="text-center text-xs text-zinc-500">
        {queueLength} left in inbox · j/k to browse
      </div>
      <div className="text-center">
        {track.imageUrl ? (
          <img src={track.imageUrl} alt="" className="mx-auto h-40 w-40 rounded object-cover" />
        ) : (
          <div className="mx-auto flex h-40 w-40 items-center justify-center rounded bg-zinc-800 text-4xl">
            🎵
          </div>
        )}
        <div className="mt-2 font-semibold">{track.name}</div>
        <div className="text-sm text-zinc-400">{track.artists}</div>
      </div>

      <div className="flex justify-center gap-2 text-xs">
        <button onClick={() => onPlay(track.uri)} className="rounded bg-zinc-700 px-2 py-1">
          ▶ Play (space)
        </button>
        <a href={track.uri} className="rounded bg-green-700 px-2 py-1">
          ↗ Open in Spotify (o)
        </a>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto">
        {numbered.map((s, i) => (
          <button
            key={s.playlistId}
            onClick={() => toggle(s.playlistId)}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
              assignedIds.has(s.playlistId)
                ? 'bg-green-800 text-white'
                : s.score >= SUGGESTION_THRESHOLD
                  ? 'bg-zinc-700 text-white'
                  : 'bg-zinc-900 text-zinc-400'
            }`}
          >
            <span>
              <span className="mr-2 text-zinc-500">{i + 1}</span>
              {s.playlistName}
            </span>
            <span className="text-xs">
              {s.score} · {s.reason}
            </span>
          </button>
        ))}
        {subPlaylists.length === 0 && (
          <p className="p-2 text-xs text-zinc-500">
            Create a playlist in the left pane to start triaging.
          </p>
        )}
      </div>

      <div className="flex gap-2 text-sm">
        <button
          onClick={() => onSkip(track.uri)}
          className="flex-1 rounded bg-zinc-800 px-2 py-1.5"
        >
          Skip (s)
        </button>
        <button onClick={onDone} className="flex-1 rounded bg-green-600 px-2 py-1.5">
          Done → next (enter)
        </button>
      </div>
    </div>
  );
}
