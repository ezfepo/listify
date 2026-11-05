import { useEffect, useState } from 'react';
import { api, FEATURE_KEYS, type PlaylistSuggestion, type TrackView } from '../lib/api';
import { Chip } from '../ui';

interface InspectorProps {
  track: TrackView | undefined;
  onPlay: (uri: string) => void;
  onOpenInTriage: () => void;
}

/** Right-hand detail card for the focused song in Organize. */
export function Inspector({ track, onPlay, onOpenInTriage }: InspectorProps) {
  const [suggestions, setSuggestions] = useState<PlaylistSuggestion[]>([]);
  const uri = track?.uri;

  useEffect(() => {
    setSuggestions([]);
    if (!uri) return;
    let cancelled = false;
    api.getTrackSuggestions(uri).then((result) => {
      if (!cancelled) setSuggestions(result);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (!track) {
    return <p className="p-4 text-sm text-muted">Select a song in the table to inspect it.</p>;
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        {track.imageUrl ? (
          <img src={track.imageUrl} alt="" className="h-16 w-16 rounded object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded bg-raise">🎵</div>
        )}
        <div className="min-w-0">
          <div className="truncate font-semibold">{track.name}</div>
          <div className="truncate text-sm text-muted">{track.artists}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <button
          onClick={() => onPlay(track.uri)}
          className="rounded bg-raise px-3 py-1.5 hover:bg-line"
        >
          ▶ Play
        </button>
        <a href={track.uri} className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90">
          ↗ Open in Spotify
        </a>
        <button
          onClick={onOpenInTriage}
          className="rounded border border-line px-3 py-1.5 hover:bg-raise"
        >
          Open in Triage
        </button>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          Suggestions
        </h3>
        {suggestions.length === 0 && <p className="text-sm text-muted">No suggestions yet.</p>}
        <ul className="space-y-1">
          {suggestions.slice(0, 5).map((s) => (
            <li key={s.playlistId} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{s.playlistName}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                {s.score} · {s.reason}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {track.features && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {FEATURE_KEYS.filter((k) => track.features?.[k] !== undefined).map((k) => (
            <div key={k} className="flex justify-between">
              <dt className="text-muted">{k}</dt>
              <dd className="font-mono tabular-nums">{track.features![k]!.toFixed(2)}</dd>
            </div>
          ))}
        </dl>
      )}

      {track.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {track.tags.map((t) => (
            <Chip key={`${t.source}:${t.tag}`}>{t.tag}</Chip>
          ))}
        </div>
      )}
    </div>
  );
}
