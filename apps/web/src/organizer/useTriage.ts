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
  onSkip,
  onDone,
  onPlay,
  registerHotkeys,
}: UseTriageOptions) {
  const [suggestions, setSuggestions] = useState<PlaylistSuggestion[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<number>>(new Set());
  const trackUri = track?.uri;

  useEffect(() => {
    setAssignedIds(new Set());
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

  function assign(playlistId: number) {
    if (!track) return;
    onAssign(track.uri, playlistId);
    setAssignedIds((prev) => new Set(prev).add(playlistId));
  }

  useEffect(() => {
    if (!track) {
      registerHotkeys(null);
      return;
    }
    function assignTo(playlistId: number) {
      onAssign(track!.uri, playlistId);
      setAssignedIds((prev) => new Set(prev).add(playlistId));
    }
    registerHotkeys({
      togglePlaylist: (index) => {
        const target = targets[index];
        if (target) assignTo(target.playlistId);
      },
      acceptSuggestions: () => {
        for (const t of targets) {
          if (t.score >= SUGGESTION_THRESHOLD) assignTo(t.playlistId);
        }
      },
      openInSpotify: () => window.open(track.uri, '_blank'),
      play: () => onPlay(track.uri),
      markDone: () => onDone(),
      skip: () => onSkip(track.uri),
    });
    return () => registerHotkeys(null);
  }, [track, targets, onAssign, onDone, onPlay, onSkip, registerHotkeys]);

  return { targets, assignedIds, assign };
}
