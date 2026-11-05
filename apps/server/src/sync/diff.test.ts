import { describe, expect, it } from 'vitest';
import { diff, type DiffInput } from './diff.js';

function baseInput(overrides: Partial<DiffInput> = {}): DiffInput {
  return {
    subPlaylists: [],
    organizedUris: [],
    actualArchiveUris: [],
    actualMainUris: [],
    localTrackUris: [],
    ...overrides,
  };
}

describe('diff', () => {
  it('creates a playlist for a sub-playlist with no spotify id yet', () => {
    const result = diff(
      baseInput({
        subPlaylists: [{ id: 1, spotifyId: null, name: 'Sad', desiredUris: [], actualUris: [] }],
      }),
    );
    expect(result.operations).toContainEqual({
      kind: 'createPlaylist',
      playlistId: 1,
      name: 'Sad',
    });
  });

  it('does not create a playlist that already has a spotify id', () => {
    const result = diff(
      baseInput({
        subPlaylists: [{ id: 1, spotifyId: 'sp1', name: 'Sad', desiredUris: [], actualUris: [] }],
      }),
    );
    expect(result.operations.some((op) => op.kind === 'createPlaylist')).toBe(false);
  });

  it('adds tracks that are desired but not yet actually in the sub-playlist', () => {
    const result = diff(
      baseInput({
        subPlaylists: [
          {
            id: 1,
            spotifyId: 'sp1',
            name: 'Sad',
            desiredUris: ['spotify:track:1', 'spotify:track:2'],
            actualUris: ['spotify:track:1'],
          },
        ],
      }),
    );
    expect(result.operations).toContainEqual({
      kind: 'addToPlaylist',
      playlistId: 1,
      uris: ['spotify:track:2'],
    });
  });

  it('is a no-op (already-applied) when desired already matches actual', () => {
    const result = diff(
      baseInput({
        subPlaylists: [
          {
            id: 1,
            spotifyId: 'sp1',
            name: 'Sad',
            desiredUris: ['spotify:track:1'],
            actualUris: ['spotify:track:1'],
          },
        ],
      }),
    );
    expect(result.operations.some((op) => op.kind === 'addToPlaylist')).toBe(false);
  });

  it('dedupes duplicate URIs within a single sub-playlist desired list', () => {
    const result = diff(
      baseInput({
        subPlaylists: [
          {
            id: 1,
            spotifyId: 'sp1',
            name: 'Sad',
            desiredUris: ['spotify:track:1', 'spotify:track:1', 'spotify:track:1'],
            actualUris: [],
          },
        ],
      }),
    );
    const op = result.operations.find((o) => o.kind === 'addToPlaylist');
    expect(op).toEqual({ kind: 'addToPlaylist', playlistId: 1, uris: ['spotify:track:1'] });
  });

  it('adds a shared song to every sub-playlist it is desired in', () => {
    const result = diff(
      baseInput({
        subPlaylists: [
          {
            id: 1,
            spotifyId: 'sp1',
            name: 'Sad',
            desiredUris: ['spotify:track:1'],
            actualUris: [],
          },
          {
            id: 2,
            spotifyId: 'sp2',
            name: 'Road',
            desiredUris: ['spotify:track:1'],
            actualUris: [],
          },
        ],
      }),
    );
    expect(result.operations).toContainEqual({
      kind: 'addToPlaylist',
      playlistId: 1,
      uris: ['spotify:track:1'],
    });
    expect(result.operations).toContainEqual({
      kind: 'addToPlaylist',
      playlistId: 2,
      uris: ['spotify:track:1'],
    });
  });

  it('adds organized tracks not yet in the actual archive', () => {
    const result = diff(
      baseInput({
        organizedUris: ['spotify:track:1', 'spotify:track:2'],
        actualArchiveUris: ['spotify:track:1'],
      }),
    );
    expect(result.operations).toContainEqual({
      kind: 'addToArchive',
      uris: ['spotify:track:2'],
    });
  });

  it('does not re-add an organized track already in the actual archive', () => {
    const result = diff(
      baseInput({
        organizedUris: ['spotify:track:1'],
        actualArchiveUris: ['spotify:track:1'],
      }),
    );
    expect(result.operations.some((op) => op.kind === 'addToArchive')).toBe(false);
  });

  it('removes organized tracks that are still actually in Main', () => {
    const result = diff(
      baseInput({
        organizedUris: ['spotify:track:1', 'spotify:track:2'],
        actualMainUris: ['spotify:track:1'],
      }),
    );
    expect(result.operations).toContainEqual({
      kind: 'removeFromMain',
      uris: ['spotify:track:1'],
    });
  });

  it('does not remove a track from Main that is not organized (still inbox)', () => {
    const result = diff(
      baseInput({
        organizedUris: [],
        actualMainUris: ['spotify:track:1'],
      }),
    );
    expect(result.operations.some((op) => op.kind === 'removeFromMain')).toBe(false);
  });

  it('does not remove a track already gone from Main (already-applied)', () => {
    const result = diff(
      baseInput({
        organizedUris: ['spotify:track:1'],
        actualMainUris: [],
      }),
    );
    expect(result.operations.some((op) => op.kind === 'removeFromMain')).toBe(false);
  });

  it('excludes local tracks from every operation and reports them separately', () => {
    const result = diff(
      baseInput({
        subPlaylists: [
          {
            id: 1,
            spotifyId: 'sp1',
            name: 'Sad',
            desiredUris: ['spotify:track:1', 'spotify:local:abc'],
            actualUris: [],
          },
        ],
        organizedUris: ['spotify:track:1', 'spotify:local:abc'],
        actualMainUris: ['spotify:track:1', 'spotify:local:abc'],
        localTrackUris: ['spotify:local:abc'],
      }),
    );
    const addOp = result.operations.find((op) => op.kind === 'addToPlaylist');
    expect(addOp).toEqual({ kind: 'addToPlaylist', playlistId: 1, uris: ['spotify:track:1'] });
    const archiveOp = result.operations.find((op) => op.kind === 'addToArchive');
    expect(archiveOp).toEqual({ kind: 'addToArchive', uris: ['spotify:track:1'] });
    const removeOp = result.operations.find((op) => op.kind === 'removeFromMain');
    expect(removeOp).toEqual({ kind: 'removeFromMain', uris: ['spotify:track:1'] });
    expect(result.skippedLocalUris).toEqual(['spotify:local:abc']);
  });

  it('produces no operations at all when nothing has changed', () => {
    const result = diff(
      baseInput({
        subPlaylists: [
          {
            id: 1,
            spotifyId: 'sp1',
            name: 'Sad',
            desiredUris: ['spotify:track:1'],
            actualUris: ['spotify:track:1'],
          },
        ],
        organizedUris: ['spotify:track:1'],
        actualArchiveUris: ['spotify:track:1'],
        actualMainUris: [],
      }),
    );
    expect(result.operations).toEqual([]);
  });
});
