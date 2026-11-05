import { useRef, useState } from 'react';
import { api, type ApplySummary, type DiffOperation, type DiffPreview } from '../lib/api';

function describeOp(op: DiffOperation): string {
  switch (op.kind) {
    case 'createPlaylist':
      return `Create playlist "${op.name}"`;
    case 'addToPlaylist':
      return `Add ${op.uris.length} track(s) to playlist #${op.playlistId}`;
    case 'addToArchive':
      return `Add ${op.uris.length} track(s) to Archive`;
    case 'removeFromMain':
      return `Remove ${op.uris.length} track(s) from Main`;
  }
}

function OperationList({ operations }: { operations: DiffOperation[] }) {
  if (operations.length === 0) {
    return <p className="text-sm text-muted">Nothing to do — everything is already in sync.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {operations.map((op, i) => (
        <li key={i} className="rounded bg-raise px-2 py-1">
          {describeOp(op)}
        </li>
      ))}
    </ul>
  );
}

export function SyncPanel() {
  const [preview, setPreview] = useState<DiffPreview | null>(null);
  const [applyResult, setApplyResult] = useState<ApplySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadPreview() {
    setBusy(true);
    setError(null);
    setApplyResult(null);
    try {
      setPreview(await api.getSyncDiff());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runApply() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.applySync();
      setApplyResult(result);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function exportJson() {
    window.location.href = '/api/export';
  }

  async function importJson(file: File) {
    setImportMessage(null);
    setError(null);
    try {
      const text = await file.text();
      await api.importSnapshot(JSON.parse(text));
      setImportMessage('Import complete.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 text-sm">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Sync to Spotify</h2>
        <p className="text-muted">
          Preview what applying your local organizing would do to Spotify, then apply it. Until
          Phase 6, applies are dry-run: every planned write is logged, nothing actually touches
          Spotify.
        </p>
        <div className="flex gap-2">
          <button
            onClick={loadPreview}
            disabled={busy}
            className="rounded bg-raise px-3 py-1.5 disabled:opacity-40"
          >
            Preview Diff
          </button>
          <button
            onClick={runApply}
            disabled={busy}
            className="rounded bg-accent text-white px-3 py-1.5 disabled:opacity-40"
          >
            Apply
          </button>
        </div>

        {error && <p className="text-danger">{error}</p>}

        {preview && (
          <div className="space-y-2 rounded border border-line p-3">
            <h3 className="font-medium">Diff Preview</h3>
            <OperationList operations={preview.operations} />
            {preview.skippedLocalUris.length > 0 && (
              <p className="text-muted">
                Skipping {preview.skippedLocalUris.length} local-file track(s) (Spotify can't manage
                these by URI).
              </p>
            )}
          </div>
        )}

        {applyResult && (
          <div className="space-y-2 rounded border border-line p-3">
            <h3 className="font-medium">
              Apply result {applyResult.dryRun && <span className="text-amber-700">(dry run)</span>}
            </h3>
            <p className="text-muted">Backup written to {applyResult.backupPath}</p>
            <ul className="space-y-1">
              {applyResult.operations.map((entry, i) => (
                <li key={i} className="rounded bg-raise px-2 py-1">
                  <span
                    className={
                      entry.status === 'failed'
                        ? 'text-danger'
                        : entry.status === 'dry_run'
                          ? 'text-amber-700'
                          : 'text-done'
                    }
                  >
                    [{entry.status}]
                  </span>{' '}
                  {describeOp(entry.operation)}
                  {entry.error && <span className="text-danger"> — {entry.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-line pt-6">
        <h2 className="text-base font-semibold">Backup</h2>
        <div className="flex items-center gap-2">
          <button onClick={exportJson} className="rounded bg-raise px-3 py-1.5">
            Export JSON
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded bg-raise px-3 py-1.5"
          >
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
              e.target.value = '';
            }}
          />
        </div>
        {importMessage && <p className="text-done">{importMessage}</p>}
      </section>
    </div>
  );
}
