import { useEffect, useState } from 'react';

type HealthState = { status: 'loading' } | { status: 'ok' } | { status: 'error'; message: string };

type MeState =
  | { status: 'loading' }
  | { status: 'connected'; displayName: string }
  | { status: 'disconnected' }
  | { status: 'error'; message: string };

function readAuthError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('auth_error');
  if (error) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  return error;
}

export default function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const [me, setMe] = useState<MeState>({ status: 'loading' });
  const [authError] = useState<string | null>(() => readAuthError());

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-semibold">Listify</h1>
        <div className="space-y-2">
          {health.status === 'loading' && <p className="text-zinc-400">Checking API…</p>}
          {health.status === 'ok' && <p className="text-green-400">/api/health OK</p>}
          {health.status === 'error' && <p className="text-red-400">API error: {health.message}</p>}
        </div>

        {authError && (
          <p className="text-red-400 text-sm">Spotify connection failed: {authError}</p>
        )}

        <div>
          {me.status === 'loading' && <p className="text-zinc-400">Checking Spotify connection…</p>}
          {me.status === 'connected' && (
            <p className="text-green-400">Connected as {me.displayName}</p>
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
