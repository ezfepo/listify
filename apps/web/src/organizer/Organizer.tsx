import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type PlaylistView, type TrackStatus } from '../lib/api';
import { AutoSortPanel } from './AutoSortPanel';
import { CenterTable } from './CenterTable';
import { LeftPane } from './LeftPane';
import { RecipeEditor } from './RecipeEditor';
import { TriagePanel, type TriageHotkeys } from './TriagePanel';
import { useUndoIndicator } from './UndoIndicator';
import { useUndoStack } from './useUndoStack';

type RightMode = 'triage' | 'autosort';
type PlaylistSelection = number | 'main' | 'archive' | null;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function Organizer() {
  const queryClient = useQueryClient();
  const { push: pushUndo, undo, topLabel } = useUndoStack();
  const { setTopLabel } = useUndoIndicator();

  useEffect(() => setTopLabel(topLabel), [topLabel, setTopLabel]);
  // Clear it when the Organizer unmounts (e.g. switching to the Setup tab) so a
  // stale "last action" doesn't linger in the header outside this view.
  useEffect(() => () => setTopLabel(null), [setTopLabel]);

  const [statusFilter, setStatusFilter] = useState<TrackStatus | null>(null);
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<PlaylistSelection>(null);
  const [editingRecipeId, setEditingRecipeId] = useState<number | null>(null);
  const [rightMode, setRightMode] = useState<RightMode>('triage');
  const [triageIndex, setTriageIndex] = useState(0);
  const [focusedTrackUri, setFocusedTrackUri] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hotkeysRef = useRef<TriageHotkeys | null>(null);

  const library = useQuery({ queryKey: ['library'], queryFn: api.getLibrary });
  const tracks = useQuery({
    // Viewing a playlist shows its full contents regardless of status (a real
    // playlist view), so the status filter only applies when no playlist is selected.
    queryKey: ['tracks', selectedPlaylistId ? 'all' : statusFilter, search],
    queryFn: () =>
      api.getTracks({
        status: selectedPlaylistId ? undefined : (statusFilter ?? undefined),
        q: search || undefined,
      }),
    // Keep showing the previous page's rows while a new search/filter is in flight,
    // instead of unmounting the table (and its focused search input) on every keystroke.
    placeholderData: (previous) => previous,
  });
  const inboxTracks = useQuery({
    queryKey: ['tracks', 'inbox-queue'],
    queryFn: () => api.getTracks({ status: 'inbox' }),
  });

  const playlists: PlaylistView[] = library.data?.playlists ?? [];
  const trackList = tracks.data?.items ?? [];
  const inboxList = inboxTracks.data?.items ?? [];

  const displayedTracks = useMemo(() => {
    if (selectedPlaylistId === 'main') return trackList.filter((t) => t.inMain);
    if (selectedPlaylistId === 'archive') return trackList.filter((t) => t.inArchive);
    if (typeof selectedPlaylistId === 'number') {
      return trackList.filter((t) => t.playlists.some((p) => p.id === selectedPlaylistId));
    }
    return trackList;
  }, [trackList, selectedPlaylistId]);

  const focusedTrack = focusedTrackUri
    ? [...trackList, ...inboxList].find((t) => t.uri === focusedTrackUri)
    : undefined;
  const currentTriageTrack =
    focusedTrack ?? inboxList[Math.min(triageIndex, Math.max(inboxList.length - 1, 0))];

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 3000);
  }, []);

  const reportError = useCallback(
    (err: unknown) => showToast(err instanceof ApiError ? err.message : 'Something went wrong'),
    [showToast],
  );

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['library'] });
    queryClient.invalidateQueries({ queryKey: ['tracks'] });
  }, [queryClient]);

  const doAssign = useCallback(
    async (uri: string, playlistId: number, record = true) => {
      try {
        await api.assignTrack(uri, playlistId);
        invalidateAll();
        if (record) {
          const name = playlists.find((p) => p.id === playlistId)?.name ?? 'playlist';
          pushUndo({
            label: `Assign to ${name}`,
            undo: async () => {
              await api.unassignTrack(uri, playlistId);
              invalidateAll();
            },
          });
        }
      } catch (err) {
        reportError(err);
      }
    },
    [invalidateAll, playlists, pushUndo, reportError],
  );

  const doUnassign = useCallback(
    async (uri: string, playlistId: number) => {
      try {
        await api.unassignTrack(uri, playlistId);
        invalidateAll();
        pushUndo({
          label: 'Unassign',
          undo: async () => {
            await api.assignTrack(uri, playlistId);
            invalidateAll();
          },
        });
      } catch (err) {
        reportError(err);
      }
    },
    [invalidateAll, pushUndo, reportError],
  );

  const doBulkAssign = useCallback(
    async (uris: string[], playlistId: number) => {
      try {
        await api.bulkAssign(uris, playlistId);
        invalidateAll();
        const name = playlists.find((p) => p.id === playlistId)?.name ?? 'playlist';
        pushUndo({
          label: `Assign ${uris.length} to ${name}`,
          undo: async () => {
            await api.bulkUnassign(uris, playlistId);
            invalidateAll();
          },
        });
        setSelection(new Set());
      } catch (err) {
        reportError(err);
      }
    },
    [invalidateAll, playlists, pushUndo, reportError],
  );

  const doBulkUnassign = useCallback(
    async (uris: string[], playlistId: number) => {
      try {
        await api.bulkUnassign(uris, playlistId);
        invalidateAll();
        const name = playlists.find((p) => p.id === playlistId)?.name ?? 'playlist';
        pushUndo({
          label: `Unassign ${uris.length} from ${name}`,
          undo: async () => {
            await api.bulkAssign(uris, playlistId);
            invalidateAll();
          },
        });
        setSelection(new Set());
      } catch (err) {
        reportError(err);
      }
    },
    [invalidateAll, playlists, pushUndo, reportError],
  );

  const doSetStatus = useCallback(
    async (uri: string, status: TrackStatus) => {
      const previous = [...trackList, ...inboxList].find((t) => t.uri === uri)?.status ?? 'inbox';
      try {
        await api.setTrackStatus(uri, status);
        invalidateAll();
        pushUndo({
          label: `Mark ${status}`,
          undo: async () => {
            await api.setTrackStatus(uri, previous);
            invalidateAll();
          },
        });
      } catch (err) {
        reportError(err);
      }
    },
    [inboxList, invalidateAll, pushUndo, reportError, trackList],
  );

  const doPlay = useCallback(
    async (uri: string) => {
      try {
        await api.playTrack(uri);
      } catch {
        showToast('No active Spotify device to play on.');
      }
    },
    [showToast],
  );

  const createPlaylist = useCallback(
    async (name: string) => {
      try {
        await api.createPlaylist({ name });
        invalidateAll();
      } catch (err) {
        reportError(err);
      }
    },
    [invalidateAll, reportError],
  );

  const deletePlaylist = useCallback(
    async (id: number) => {
      try {
        await api.deletePlaylist(id);
        if (selectedPlaylistId === id) setSelectedPlaylistId(null);
        invalidateAll();
      } catch (err) {
        reportError(err);
      }
    },
    [invalidateAll, reportError, selectedPlaylistId],
  );

  function handleStatusFilterChange(status: TrackStatus | null) {
    setSelectedPlaylistId(null);
    setStatusFilter(status);
  }

  function handleSelectPlaylist(id: PlaylistSelection) {
    setStatusFilter(null);
    setSelectedPlaylistId((prev) => (prev === id ? null : id));
  }

  function focusTrack(uri: string) {
    setFocusedTrackUri(uri);
    setRightMode('triage');
  }

  function toggleSelect(uri: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  }

  // Global keyboard shortcuts (plan.md §4). Triage-specific keys (1-9, a, o, space,
  // enter, s) only act while the Triage panel is mounted and has registered handlers.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === 'u') {
        e.preventDefault();
        void undo();
        return;
      }

      const hotkeys = rightMode === 'triage' ? hotkeysRef.current : null;
      if (!hotkeys) return;

      if (e.key === 'j') {
        e.preventDefault();
        setFocusedTrackUri(null);
        setTriageIndex((i) => Math.min(i + 1, Math.max(inboxList.length - 1, 0)));
      } else if (e.key === 'k') {
        e.preventDefault();
        setFocusedTrackUri(null);
        setTriageIndex((i) => Math.max(i - 1, 0));
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        hotkeys.togglePlaylist(Number(e.key) - 1);
      } else if (e.key === 'a') {
        e.preventDefault();
        hotkeys.acceptSuggestions();
      } else if (e.key === 'o') {
        e.preventDefault();
        hotkeys.openInSpotify();
      } else if (e.key === ' ') {
        e.preventDefault();
        hotkeys.play();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        hotkeys.markDone();
      } else if (e.key === 's') {
        e.preventDefault();
        hotkeys.skip();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [rightMode, inboxList.length, undo]);

  const registerHotkeys = useCallback((handlers: TriageHotkeys | null) => {
    hotkeysRef.current = handlers;
  }, []);

  const editingPlaylist = useMemo(
    () => playlists.find((p) => p.id === editingRecipeId),
    [editingRecipeId, playlists],
  );
  // Only a real sub-playlist can be a bulk-assign target or have an Auto-sort view —
  // Main/Archive are read-only browsing entries (see LeftPane).
  const selectedSubPlaylist = useMemo(
    () =>
      typeof selectedPlaylistId === 'number'
        ? playlists.find((p) => p.id === selectedPlaylistId && p.kind === 'sub')
        : undefined,
    [playlists, selectedPlaylistId],
  );

  if (library.isLoading) {
    return <p className="p-4 text-sm text-zinc-400">Loading your library…</p>;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full">
      <LeftPane
        statusCounts={library.data?.statusCounts ?? { inbox: 0, organized: 0, skipped: 0 }}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        playlists={playlists}
        selectedPlaylistId={selectedPlaylistId}
        onSelectPlaylist={handleSelectPlaylist}
        onCreatePlaylist={createPlaylist}
        onDeletePlaylist={deletePlaylist}
        onEditRecipe={setEditingRecipeId}
      />

      <CenterTable
        ref={searchInputRef}
        tracks={displayedTracks}
        selection={selection}
        onToggleSelect={toggleSelect}
        onClearSelection={() => setSelection(new Set())}
        search={search}
        onSearchChange={setSearch}
        playlists={playlists}
        onAssign={doAssign}
        onUnassign={doUnassign}
        onBulkAssign={doBulkAssign}
        onBulkUnassign={doBulkUnassign}
        onSetStatus={doSetStatus}
        onPlay={doPlay}
        onFocusTrack={focusTrack}
      />

      <div className="flex h-full min-h-0 shrink-0 flex-col">
        <div className="flex border-b border-zinc-800 text-xs">
          <button
            onClick={() => setRightMode('triage')}
            className={`flex-1 px-3 py-2 ${rightMode === 'triage' ? 'bg-zinc-800' : 'text-zinc-500'}`}
          >
            Triage
          </button>
          <button
            onClick={() => setRightMode('autosort')}
            disabled={!selectedSubPlaylist}
            className={`flex-1 px-3 py-2 disabled:opacity-40 ${rightMode === 'autosort' ? 'bg-zinc-800' : 'text-zinc-500'}`}
          >
            Auto-sort
          </button>
        </div>

        {rightMode === 'triage' && (
          <TriagePanel
            track={currentTriageTrack}
            queueLength={inboxList.length}
            playlists={playlists}
            onAssign={(uri, playlistId) => doAssign(uri, playlistId, false)}
            onSkip={(uri) => {
              doSetStatus(uri, 'skipped');
              setFocusedTrackUri(null);
              setTriageIndex(0);
            }}
            onDone={() => {
              setFocusedTrackUri(null);
              setTriageIndex(0);
            }}
            onPlay={doPlay}
            registerHotkeys={registerHotkeys}
          />
        )}
        {rightMode === 'autosort' && selectedSubPlaylist && (
          <AutoSortPanel
            playlistId={selectedSubPlaylist.id}
            playlistName={selectedSubPlaylist.name}
            onBulkAssign={doBulkAssign}
          />
        )}
      </div>

      {editingPlaylist && (
        <RecipeEditor
          playlistId={editingPlaylist.id}
          playlistName={editingPlaylist.name}
          onClose={() => setEditingRecipeId(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded bg-zinc-800 px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
