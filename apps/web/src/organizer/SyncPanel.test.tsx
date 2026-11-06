import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ApplySummary, type DiffPreview } from '../lib/api';
import { SyncPanel } from './SyncPanel';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: { getSyncDiff: vi.fn(), applySync: vi.fn(), importSnapshot: vi.fn() },
}));

const getSyncDiff = vi.mocked(api.getSyncDiff);
const applySync = vi.mocked(api.applySync);
const importSnapshot = vi.mocked(api.importSnapshot);

function setup() {
  render(<SyncPanel />);
}

beforeEach(() => {
  getSyncDiff.mockReset();
  applySync.mockReset();
  importSnapshot.mockReset();
});

describe('SyncPanel diff preview', () => {
  it('fetches and lists the planned operations', async () => {
    const preview: DiffPreview = {
      operations: [
        { kind: 'createPlaylist', playlistId: 1, name: 'Sad' },
        { kind: 'addToPlaylist', playlistId: 1, uris: ['spotify:track:1', 'spotify:track:2'] },
        { kind: 'addToArchive', uris: ['spotify:track:1'] },
        { kind: 'removeFromMain', uris: ['spotify:track:1'] },
      ],
      skippedLocalUris: ['spotify:local:abc'],
    };
    getSyncDiff.mockResolvedValue(preview);
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Diff' }));

    await screen.findByText('Create playlist "Sad"');
    expect(screen.getByText('Add 2 track(s) to playlist #1')).not.toBeNull();
    expect(screen.getByText('Add 1 track(s) to Archive')).not.toBeNull();
    expect(screen.getByText('Remove 1 track(s) from Main')).not.toBeNull();
    expect(screen.getByText(/Skipping 1 local-file track/)).not.toBeNull();
  });

  it('says there is nothing to do when the diff is empty', async () => {
    getSyncDiff.mockResolvedValue({ operations: [], skippedLocalUris: [] });
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Diff' }));

    await screen.findByText(/already in sync/);
  });

  it('shows an error message when the preview request fails', async () => {
    getSyncDiff.mockRejectedValue(new Error('setup_required'));
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Diff' }));

    await screen.findByText('setup_required');
  });
});

describe('SyncPanel apply', () => {
  it('applies and shows per-operation dry-run status, clearing any prior preview', async () => {
    getSyncDiff.mockResolvedValue({
      operations: [{ kind: 'addToArchive', uris: ['spotify:track:1'] }],
      skippedLocalUris: [],
    });
    const summary: ApplySummary = {
      dryRun: true,
      batchId: 'batch-1',
      backupPath: '/data/backups/backup-1.json',
      operations: [
        {
          operation: { kind: 'addToArchive', uris: ['spotify:track:1'] },
          status: 'dry_run',
        },
      ],
      skippedLocalUris: [],
    };
    applySync.mockResolvedValue(summary);
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Diff' }));
    await screen.findByText('Diff Preview');

    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await screen.findByText('(dry run)');
    expect(screen.getByText(/backup-1\.json/)).not.toBeNull();
    expect(screen.getByText('[dry_run]')).not.toBeNull();
    expect(screen.queryByText('Diff Preview')).toBeNull();
  });

  it('shows an error message when apply fails', async () => {
    applySync.mockRejectedValue(new Error('boom'));
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await screen.findByText('boom');
  });
});

describe('SyncPanel backup', () => {
  it('points Export JSON at the download endpoint', async () => {
    // jsdom's real Location doesn't let us spy on the href setter directly (and
    // assigning it triggers a "not implemented: navigation" error) — swap in a
    // plain object standing in for window.location for this one test.
    const originalLocation = window.location;
    const fakeLocation = { href: '' };
    Object.defineProperty(window, 'location', { value: fakeLocation, configurable: true });

    try {
      setup();
      await userEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
      expect(fakeLocation.href).toBe('/api/export');
    } finally {
      Object.defineProperty(window, 'location', { value: originalLocation, configurable: true });
    }
  });

  it('imports a selected JSON file and shows a success message', async () => {
    importSnapshot.mockResolvedValue(undefined);
    setup();

    const snapshot = { version: 1, exportedAt: 'now', tables: {}, settings: {} };
    const file = new File([JSON.stringify(snapshot)], 'backup.json', {
      type: 'application/json',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, file);

    await screen.findByText('Import complete.');
    expect(importSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('shows an error message when import fails', async () => {
    importSnapshot.mockRejectedValue(new Error('import_failed'));
    setup();

    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, file);

    await screen.findByText('import_failed');
  });
});

describe('SyncPanel import button', () => {
  it('opens the hidden file picker', async () => {
    setup();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Import JSON' }));
    expect(click).toHaveBeenCalledTimes(1);
  });
});
