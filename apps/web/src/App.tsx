import { useEffect, useState } from 'react';
import { Organizer, type WorkspaceMode } from './organizer/Organizer';
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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
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
      getJson<PlaylistOption[]>('/api/playlists'),
      getJson<{ mainSpotifyId: string | null; archiveSpotifyId: string | null }>('/api/setup'),
    ])
      .then(([playlistList, setup]) => {
        setPlaylists(playlistList);
        if (setup.mainSpotifyId) setMainId(setup.mainSpotifyId);
        if (setup.archiveSpotifyId) setArchiveId(setup.archiveSpotifyId);
      })
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
    // A failed load must not leave the user on a spinner forever.
    if (error) return <p className="text-danger text-sm">Could not load playlists: {error}</p>;
    return <p className="text-muted text-sm">Loading playlists…</p>;
  }

  return (
    <div className="space-y-3 text-sm text-left w-80">
      <label className="block">
        <span className="text-muted">Main</span>
        <select
          className="mt-1 w-full rounded bg-surface border border-line px-2 py-1"
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
        <span className="text-muted">Archive</span>
        <select
          className="mt-1 w-full rounded bg-surface border border-line px-2 py-1"
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
          className="rounded bg-raise px-3 py-1 disabled:opacity-40"
        >
          Save
        </button>
        <button
          disabled={!saved || busy}
          onClick={runPull}
          className="rounded bg-accent text-white px-3 py-1 disabled:opacity-40"
        >
          Pull
        </button>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {pullResult && (
        <div className="text-done">
          <p>Main: {pullResult.mainTrackCount} tracks</p>
          <p>Archive: {pullResult.archiveTrackCount} tracks</p>
          {pullResult.subPlaylists.map((s) => (
            <p key={s.name}>
              {s.name}: {s.trackCount} tracks
            </p>
          ))}
          {pullResult.skippedEpisodes > 0 && (
            <p className="text-muted">Skipped {pullResult.skippedEpisodes} episode(s)</p>
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
  const [view, setView] = useState<'setup' | WorkspaceMode | 'sync'>('setup');

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
      <div className="min-h-screen bg-ground text-ink flex flex-col items-center justify-center gap-6 py-10">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-semibold">Listify</h1>
          <div className="space-y-2">
            {health.status === 'loading' && <p className="text-muted">Checking API…</p>}
            {health.status === 'ok' && <p className="text-done">/api/health OK</p>}
            {health.status === 'error' && (
              <p className="text-danger">API error: {health.message}</p>
            )}
          </div>

          {authError && (
            <p className="text-danger text-sm">Spotify connection failed: {authError}</p>
          )}

          <div>
            {me.status === 'loading' && <p className="text-muted">Checking Spotify connection…</p>}
            {me.status === 'disconnected' && (
              <a
                href="/auth/login"
                className="inline-block rounded bg-accent px-4 py-2 font-medium text-white hover:opacity-90"
              >
                Connect to Spotify
              </a>
            )}
            {me.status === 'error' && <p className="text-danger">API error: {me.message}</p>}
          </div>
        </div>
      </div>
    );
  }

  const tabs: { key: typeof view; label: string }[] = [
    { key: 'setup', label: 'Setup' },
    { key: 'organize', label: 'Organize' },
    { key: 'triage', label: 'Triage' },
    { key: 'sync', label: 'Sync' },
  ];

  return (
    <UndoIndicatorProvider>
      <div className="min-h-screen bg-ground text-ink">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-surface px-4">
          <h1 className="text-lg font-semibold">Listify</h1>
          <nav aria-label="Views" className="flex">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                aria-current={view === tab.key ? 'page' : undefined}
                className={`h-14 border-b-2 px-3 text-sm ${
                  view === tab.key
                    ? 'border-accent font-medium text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <UndoIndicatorDisplay />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <p className="flex items-center gap-1.5 text-done">
              <span aria-hidden className="h-2 w-2 rounded-full bg-done" />
              Connected as {me.displayName}
            </p>
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="rounded bg-raise px-3 py-1 disabled:opacity-40"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </header>

        {authError && (
          <p className="p-2 text-center text-sm text-danger">
            Spotify connection failed: {authError}
          </p>
        )}

        {view === 'setup' && (
          <div className="flex justify-center py-10">
            <SetupAndPull onPulled={() => setView('organize')} />
          </div>
        )}
        {(view === 'organize' || view === 'triage') && (
          <Organizer mode={view} onModeChange={setView} />
        )}
        {view === 'sync' && <SyncPanel />}
      </div>
    </UndoIndicatorProvider>
  );
}
