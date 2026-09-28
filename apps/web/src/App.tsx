import { useEffect, useState } from 'react';
import { Organizer } from './organizer/Organizer';
import { SyncPanel } from './organizer/SyncPanel';
import { UndoIndicatorDisplay, UndoIndicatorProvider } from './organizer/UndoIndicator';

type HealthState = { status: 'loading' } | { status: 'ok' } | { status: 'error'; message: string };

type MeState =
  | { status: 'loading' }
  | { status: 'connected'; displayName: string }
  | { status: 'disconnected' }
  | { status: 'error'; message: string };

type PlaylistOption = {
  id: string;
  name: string;
  ownerDisplayName: string | null;
  trackCount: number;
};

type PullSummary = {
  mainTrackCount: number;
  archiveTrackCount: number;
  subPlaylists: { name: string; trackCount: number }[];
  skippedEpisodes: number;
};

function readAuthError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('auth_error');
  if (error) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  return error;
}

function SetupAndPull({ onPulled }: { onPulled: () => void }) {
  const [playlists, setPlaylists] = useState<PlaylistOption[] | null>(null);
  const [mainId, setMainId] = useState('');
  const [archiveId, setArchiveId] = useState('');
  const [saved, setSaved] = useState(false);
  const [pullResult, setPullResult] = useState<PullSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/playlists').then((res) => res.json()),
      fetch('/api/setup').then((res) => res.json()),
    ])
      .then(
        ([playlistList, setup]: [
          PlaylistOption[],
          { mainSpotifyId: string | null; archiveSpotifyId: string | null },
        ]) => {
          setPlaylists(playlistList);
          if (setup.mainSpotifyId) setMainId(setup.mainSpotifyId);
          if (setup.archiveSpotifyId) setArchiveId(setup.archiveSpotifyId);
        },
      )
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function saveSetup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mainSpotifyId: mainId, archiveSpotifyId: archiveId, adopt: [] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runPull() {
    setBusy(true);
    setError(null);
    setPullResult(null);
    try {
      const res = await fetch('/api/sync/pull', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setPullResult(data);
      onPulled();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!playlists) {
    return <p className="text-zinc-400 text-sm">Loading playlists…</p>;
  }

  return (
    <div className="space-y-3 text-sm text-left w-80">
      <label className="block">
        <span className="text-zinc-400">Main</span>
        <select
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
          value={mainId}
          onChange={(e) => setMainId(e.target.value)}
        >
          <option value="">Choose a playlist…</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.trackCount})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-zinc-400">Archive</span>
        <select
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
          value={archiveId}
          onChange={(e) => setArchiveId(e.target.value)}
        >
          <option value="">Choose a playlist…</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.trackCount})
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button
          disabled={!mainId || !archiveId || busy}
          onClick={saveSetup}
          className="rounded bg-zinc-700 px-3 py-1 disabled:opacity-40"
        >
          Save
        </button>
        <button
          disabled={!saved || busy}
          onClick={runPull}
          className="rounded bg-green-600 px-3 py-1 disabled:opacity-40"
        >
          Pull
        </button>
      </div>
      {error && <p className="text-red-400">{error}</p>}
      {pullResult && (
        <div className="text-green-400">
          <p>Main: {pullResult.mainTrackCount} tracks</p>
          <p>Archive: {pullResult.archiveTrackCount} tracks</p>
          {pullResult.subPlaylists.map((s) => (
            <p key={s.name}>
              {s.name}: {s.trackCount} tracks
            </p>
          ))}
          {pullResult.skippedEpisodes > 0 && (
            <p className="text-zinc-400">Skipped {pullResult.skippedEpisodes} episode(s)</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const [me, setMe] = useState<MeState>({ status: 'loading' });
  const [authError] = useState<string | null>(() => readAuthError());
  const [disconnecting, setDisconnecting] = useState(false);
  const [view, setView] = useState<'setup' | 'organize' | 'sync'>('setup');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) =>
        setHealth(
          data.status === 'ok'
            ? { status: 'ok' }
            : { status: 'error', message: 'unexpected response' },
        ),
      )
      .catch((err: unknown) =>
        setHealth({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  useEffect(() => {
    fetch('/api/me')
      .then(async (res) => {
        if (res.status === 401) {
          setMe({ status: 'disconnected' });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setMe({ status: 'connected', displayName: data.displayName ?? data.id });
      })
      .catch((err: unknown) =>
        setMe({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  async function disconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/auth/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMe({ status: 'disconnected' });
    } catch (err) {
      setMe({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setDisconnecting(false);
    }
  }

  if (me.status !== 'connected') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-6 py-10">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-semibold">Listify</h1>
          <div className="space-y-2">
            {health.status === 'loading' && <p className="text-zinc-400">Checking API…</p>}
            {health.status === 'ok' && <p className="text-green-400">/api/health OK</p>}
            {health.status === 'error' && (
              <p className="text-red-400">API error: {health.message}</p>
            )}
          </div>

          {authError && (
            <p className="text-red-400 text-sm">Spotify connection failed: {authError}</p>
          )}

          <div>
            {me.status === 'loading' && (
              <p className="text-zinc-400">Checking Spotify connection…</p>
            )}
            {me.status === 'disconnected' && (
              <a
                href="/auth/login"
                className="inline-block rounded bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-500"
              >
                Connect to Spotify
              </a>
            )}
            {me.status === 'error' && <p className="text-red-400">API error: {me.message}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <UndoIndicatorProvider>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <header className="flex h-16 items-center gap-4 border-b border-zinc-800 px-4">
          <h1 className="text-lg font-semibold">Listify</h1>
          <nav className="flex gap-1">
            <button
              onClick={() => setView('setup')}
              className={`rounded px-3 py-1 text-sm ${view === 'setup' ? 'bg-zinc-700' : 'text-zinc-400 hover:bg-zinc-900'}`}
            >
              Setup
            </button>
            <button
              onClick={() => setView('organize')}
              className={`rounded px-3 py-1 text-sm ${view === 'organize' ? 'bg-zinc-700' : 'text-zinc-400 hover:bg-zinc-900'}`}
            >
              Organize
            </button>
            <button
              onClick={() => setView('sync')}
              className={`rounded px-3 py-1 text-sm ${view === 'sync' ? 'bg-zinc-700' : 'text-zinc-400 hover:bg-zinc-900'}`}
            >
              Sync
            </button>
          </nav>
          <UndoIndicatorDisplay />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <p className="text-green-400">Connected as {me.displayName}</p>
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="rounded bg-zinc-700 px-3 py-1 disabled:opacity-40"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </header>

        {authError && (
          <p className="p-2 text-center text-sm text-red-400">
            Spotify connection failed: {authError}
          </p>
        )}

        {view === 'setup' && (
          <div className="flex justify-center py-10">
            <SetupAndPull onPulled={() => setView('organize')} />
          </div>
        )}
        {view === 'organize' && <Organizer />}
        {view === 'sync' && <SyncPanel />}
      </div>
    </UndoIndicatorProvider>
  );
}
