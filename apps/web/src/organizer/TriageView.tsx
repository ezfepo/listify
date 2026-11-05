import { FEATURE_KEYS, type PlaylistView, type TrackView } from '../lib/api';
import { Chip, Kbd, ProgressBar } from '../ui';
import { SUGGESTION_THRESHOLD, useTriage, type TriageHotkeys } from './useTriage';
import type { HistoryItem } from './useUndoStack';

export type { TriageHotkeys };

interface TriageViewProps {
  track: TrackView | undefined;
  /** Inbox songs after the current one, in order. */
  upNext: TrackView[];
  queueLength: number;
  playlists: PlaylistView[];
  history: HistoryItem[];
  onUndo: () => void;
  onSelectTrack: (uri: string) => void;
  onAssign: (uri: string, playlistId: number) => void;
  onSkip: (uri: string) => void;
  onDone: () => void;
  onPlay: (uri: string) => void;
  registerHotkeys: (handlers: TriageHotkeys | null) => void;
}

const RAIL_SIZE = 8;

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Cover({ track, size }: { track: TrackView; size: string }) {
  return track.imageUrl ? (
    <img src={track.imageUrl} alt="" className={`${size} shrink-0 rounded object-cover`} />
  ) : (
    <div className={`${size} flex shrink-0 items-center justify-center rounded bg-raise`}>🎵</div>
  );
}

export function TriageView({
  track,
  upNext,
  queueLength,
  playlists,
  history,
  onUndo,
  onSelectTrack,
  onAssign,
  onSkip,
  onDone,
  onPlay,
  registerHotkeys,
}: TriageViewProps) {
  const { targets, assignedIds, assign } = useTriage({
    track,
    playlists,
    onAssign,
    onSkip,
    onDone,
    onPlay,
    registerHotkeys,
  });
  const hasSubPlaylists = playlists.some((p) => p.kind === 'sub');
  const recent = [...history].reverse();

  return (
    <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[16rem_minmax(0,1fr)_16rem]">
      <aside
        aria-label="Up next"
        className="order-2 rounded-lg border border-line bg-surface p-3 lg:order-1"
      >
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Up next</h2>
        {upNext.length === 0 && <p className="text-sm text-muted">Nothing queued.</p>}
        <ul className="space-y-1">
          {upNext.slice(0, RAIL_SIZE).map((t) => (
            <li key={t.uri}>
              <button
                onClick={() => onSelectTrack(t.uri)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-raise"
              >
                <Cover track={t} size="h-8 w-8" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{t.name}</span>
                  <span className="block truncate text-xs text-muted">{t.artists}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="order-1 min-w-0 rounded-lg border border-line bg-surface p-4 lg:order-2">
        {!track ? (
          <p className="py-16 text-center text-sm text-muted">
            Inbox is empty — nothing left to triage.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <Cover track={track} size="h-40 w-40" />
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="font-mono text-xs tabular-nums text-muted">
                  {queueLength} left in inbox · <Kbd>j</Kbd>/<Kbd>k</Kbd> to browse
                </p>
                <h2 className="mt-1 truncate text-2xl font-semibold">{track.name}</h2>
                <p className="truncate text-muted">{track.artists}</p>
                {track.album && <p className="truncate text-sm text-muted">{track.album}</p>}
                <div className="mt-3 flex flex-wrap justify-center gap-2 text-sm sm:justify-start">
                  <button
                    onClick={() => onPlay(track.uri)}
                    className="rounded bg-raise px-3 py-1.5 hover:bg-line"
                  >
                    ▶ Play <Kbd>space</Kbd>
                  </button>
                  <a
                    href={track.uri}
                    className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90"
                  >
                    ↗ Open in Spotify <span className="font-mono text-xs">(o)</span>
                  </a>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  Audio facts
                </h3>
                {track.features ? (
                  <ul className="space-y-1">
                    {FEATURE_KEYS.filter((k) => track.features?.[k] !== undefined).map((k) => {
                      const value = track.features![k]!;
                      return (
                        <li key={k} className="flex items-center gap-2 text-xs">
                          <span className="w-24 shrink-0 text-muted">{k}</span>
                          {k !== 'tempo' && k !== 'loudness' && (
                            <ProgressBar value={value * 100} label={k} />
                          )}
                          <span className="ml-auto font-mono tabular-nums">{value.toFixed(2)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No audio features yet.</p>
                )}
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  Tags
                </h3>
                <div className="flex flex-wrap gap-1">
                  {track.tags.length === 0 && <p className="text-sm text-muted">No tags yet.</p>}
                  {track.tags.map((t) => (
                    <Chip key={`${t.source}:${t.tag}`}>{t.tag}</Chip>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Send to
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {targets.map((s, i) => {
                  const assigned = assignedIds.has(s.playlistId);
                  const strong = s.score >= SUGGESTION_THRESHOLD;
                  return (
                    <button
                      key={s.playlistId}
                      onClick={() => assign(s.playlistId)}
                      aria-pressed={assigned}
                      className={`flex min-h-16 flex-col items-start justify-between rounded-lg border p-2 text-left ${
                        assigned
                          ? 'border-done bg-done-soft text-done'
                          : strong
                            ? 'border-accent bg-accent-soft'
                            : 'border-line bg-surface hover:bg-raise'
                      }`}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="truncate font-medium">{s.playlistName}</span>
                        <Kbd>{i + 1}</Kbd>
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted">
                        {s.reason ? `${s.score} · ${s.reason}` : s.score}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!hasSubPlaylists && (
                <p className="mt-2 text-sm text-muted">
                  Create a playlist in Organize to start triaging.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-line pt-3 text-sm">
              <button
                onClick={() => onSkip(track.uri)}
                className="flex-1 rounded bg-raise px-3 py-2 hover:bg-line"
              >
                Skip <Kbd>s</Kbd>
              </button>
              <button
                onClick={() => {
                  for (const t of targets) {
                    if (t.score >= SUGGESTION_THRESHOLD) assign(t.playlistId);
                  }
                }}
                className="flex-1 rounded bg-accent-soft px-3 py-2 text-accent hover:opacity-80"
              >
                Accept {SUGGESTION_THRESHOLD}+ <Kbd>a</Kbd>
              </button>
              <button
                onClick={onDone}
                className="flex-1 rounded bg-done px-3 py-2 text-white hover:opacity-90"
              >
                Done → next <Kbd>enter</Kbd>
              </button>
            </div>
          </div>
        )}
      </section>

      <aside
        aria-label="Session history"
        className="order-3 rounded-lg border border-line bg-surface p-3"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Session history
          </h2>
          <button
            onClick={onUndo}
            disabled={history.length === 0}
            className="rounded bg-raise px-2 py-0.5 text-xs hover:bg-line disabled:opacity-40"
          >
            Undo <Kbd>u</Kbd>
          </button>
        </div>
        {history.length === 0 && <p className="text-sm text-muted">No actions yet.</p>}
        <ul className="space-y-1">
          {recent.map((h) => (
            <li key={`${h.at}-${h.label}`} className="flex gap-2 text-sm">
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                {formatTime(h.at)}
              </span>
              <span className="min-w-0 truncate">{h.label}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
