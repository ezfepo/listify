import { useEffect, useState } from 'react';

type HealthState = { status: 'loading' } | { status: 'ok' } | { status: 'error'; message: string };

export default function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold">Listify</h1>
        {health.status === 'loading' && <p className="text-zinc-400">Checking API…</p>}
        {health.status === 'ok' && <p className="text-green-400">/api/health OK</p>}
        {health.status === 'error' && <p className="text-red-400">API error: {health.message}</p>}
      </div>
    </div>
  );
}
