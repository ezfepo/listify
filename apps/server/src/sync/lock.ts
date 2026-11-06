/**
 * One sync-level operation at a time (pull, apply, import, setup change), across every
 * browser/tab/curl talking to this server. Those operations await network calls between
 * their DB reads and writes, so two of them interleaving would duplicate Spotify writes
 * (e.g. two `apply`s creating the same playlist twice) or overwrite each other's work.
 *
 * Deliberately not a queue: the second caller gets an immediate error and decides.
 */
export class SyncBusyError extends Error {
  readonly operation: string;
  constructor(operation: string) {
    super(`Another sync operation is already running (${operation}). Try again when it finishes.`);
    this.operation = operation;
  }
}

let current: string | null = null;

export function currentSyncOperation(): string | null {
  return current;
}

export async function withSyncLock<T>(operation: string, fn: () => Promise<T> | T): Promise<T> {
  if (current !== null) throw new SyncBusyError(current);
  current = operation;
  try {
    return await fn();
  } finally {
    current = null;
  }
}
