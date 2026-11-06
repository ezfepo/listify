import { useEffect, useMemo, useState } from 'react';
import { api, type PlaylistSuggestion, type PlaylistView, type TrackView } from '../lib/api';

export interface TriageHotkeys {
  togglePlaylist: (index: number) => void;
  acceptSuggestions: () => void;
  openInSpotify: () => void;
  play: () => void;
  markDone: () => void;
  skip: () => void;
}

export const SUGGESTION_THRESHOLD = 60;
export const MAX_TARGETS = 9;

export interface TriageTarget {
  playlistId: number;
  playlistName: string;
  score: number;
  reason: string;
}

interface UseTriageOptions {
  track: TrackView | undefined;
  playlists: PlaylistView[];
  onAssign: (uri: string, playlistId: number) => void;
  onUnassign: (uri: string, playlistId: number) => void;
  onSkip: (uri: string) => void;
  onDone: () => void;
  onPlay: (uri: string) => void;
  registerHotkeys: (handlers: TriageHotkeys | null) => void;
}

/**
 * View-independent triage logic: fetches suggestions for the current track, builds
 * the numbered target list (best match first, then the remaining playlists, max 9)
 * and registers the hotkey handlers the workspace's keydown listener calls.
 */
export function useTriage({
  track,
  playlists,
  onAssign,
  onUnassign,
  onSkip,
  onDone,
  onPlay,
  registerHotkeys,
}: UseTriageOptions) {
  const [suggestions, setSuggestions] = useState<PlaylistSuggestion[]>([]);
  const trackUri = track?.uri;

  useEffect(() => {
    if (!trackUri) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    api.getTrackSuggestions(trackUri).then((result) => {
      if (!cancelled) setSuggestions(result);
    });
    return () => {
      cancelled = true;
    };
  }, [trackUri]);

  const targets = useMemo<TriageTarget[]>(() => {
    const scored = [...suggestions].sort((a, b) => b.score - a.score);
    const seen = new Set(scored.map((s) => s.playlistId));
    const rest = playlists
      .filter((p) => p.kind === 'sub' && !seen.has(p.id))
      .map((p) => ({ playlistId: p.id, playlistName: p.name, score: 0, reason: '' }));
    return [...scored, ...rest].slice(0, MAX_TARGETS);
  }, [suggestions, playlists]);

  // Truth comes from the server (track.playlists), so an undo is reflected here too.
  const assignedIds = useMemo(
    () => new Set((track?.playlists ?? []).map((p) => p.id)),
    [track?.playlists],
  );

  /** Click / number key: add the track to the playlist, or take it out if already there. */
  function toggle(playlistId: number) {
    if (!track) return;
    if (assignedIds.has(playlistId)) onUnassign(track.uri, playlistId);
    else onAssign(track.uri, playlistId);
  }

  /** Assign every target at or above the threshold that the track isn't in yet. */
  function acceptSuggestions() {
    if (!track) return;
    for (const t of targets) {
      if (t.score >= SUGGESTION_THRESHOLD && !assignedIds.has(t.playlistId)) {
        onAssign(track.uri, t.playlistId);
      }
    }
  }

  useEffect(() => {
    if (!track) {
      registerHotkeys(null);
      return;
    }
    registerHotkeys({
      togglePlaylist: (index) => {
        const target = targets[index];
        if (target) toggle(target.playlistId);
      },
      acceptSuggestions,
      openInSpotify: () => window.open(track.uri, '_blank'),
      play: () => onPlay(track.uri),
      markDone: () => onDone(),
      skip: () => onSkip(track.uri),
    });
    return () => registerHotkeys(null);
  }, [track, targets, assignedIds, onAssign, onUnassign, onDone, onPlay, onSkip, registerHotkeys]);

  return { targets, assignedIds, toggle, acceptSuggestions };
}
