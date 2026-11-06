import { describe, expect, it } from 'vitest';
import { currentSyncOperation, SyncBusyError, withSyncLock } from './lock.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('withSyncLock', () => {
  it('runs the function, returns its value and releases the lock', async () => {
    await expect(withSyncLock('pull', async () => 42)).resolves.toBe(42);
    expect(currentSyncOperation()).toBeNull();
  });

  it('works with synchronous functions', async () => {
    await expect(withSyncLock('setup', () => 'ok')).resolves.toBe('ok');
  });

  it('releases the lock when the function throws', async () => {
    await expect(
      withSyncLock('apply', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(currentSyncOperation()).toBeNull();
    await expect(withSyncLock('apply', async () => 1)).resolves.toBe(1);
  });

  it('rejects a second operation while one is running, naming the one that holds it', async () => {
    const gate = deferred();
    const first = withSyncLock('apply', () => gate.promise);
    expect(currentSyncOperation()).toBe('apply');

    const second = withSyncLock('pull', async () => 'never');
    await expect(second).rejects.toBeInstanceOf(SyncBusyError);
    await expect(second).rejects.toMatchObject({ operation: 'apply' });

    gate.resolve();
    await first;
    expect(currentSyncOperation()).toBeNull();
  });

  it('does not run the rejected operation at all', async () => {
    const gate = deferred();
    const first = withSyncLock('apply', () => gate.promise);
    let ran = false;
    await withSyncLock('import', async () => {
      ran = true;
    }).catch(() => {});
    expect(ran).toBe(false);
    gate.resolve();
    await first;
  });
});
