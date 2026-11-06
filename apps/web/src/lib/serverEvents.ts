/**
 * Cross-window awareness. The server bumps a revision on every change and streams it over
 * Server-Sent Events, so every tab and browser talking to it hears about changes made elsewhere.
 *
 * A change is "ours" when the revision came back in the response of a mutation we sent; any other
 * new revision is external. Our own events arrive before our own response, so while a mutation of
 * ours is in flight we hold judgement and decide when the last one settles.
 */

const REVISION_HEADER = 'x-listify-revision';

let inFlight = 0;
let ownRevision = 0;
let maxSeen = 0;
let connectedOnce = false;

const externalListeners = new Set<() => void>();

/** Called when someone else (another tab/browser/client) changed data. */
export function onExternalChange(listener: () => void): () => void {
  externalListeners.add(listener);
  return () => externalListeners.delete(listener);
}

function emitExternal(): void {
  for (const listener of externalListeners) listener();
}

/** `fetch` that tracks mutations, so their revisions are recognised as our own. */
export async function trackedFetch(input: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'GET') return fetch(input, init);

  inFlight += 1;
  let revision: number | null = null;
  try {
    const res = await fetch(input, init);
    const header = res.headers?.get?.(REVISION_HEADER);
    if (header) revision = Number(header);
    return res;
  } finally {
    inFlight -= 1;
    if (revision !== null && Number.isFinite(revision)) {
      ownRevision = Math.max(ownRevision, revision);
    }
    if (inFlight === 0 && maxSeen > ownRevision) {
      ownRevision = maxSeen;
      emitExternal();
    }
  }
}

function handleRevision(revision: number, invalidateAll: () => void): void {
  maxSeen = Math.max(maxSeen, revision);
  const baseline = !connectedOnce;
  connectedOnce = true;

  if (baseline) {
    // First message after page load: just the current state, nothing happened yet.
    ownRevision = Math.max(ownRevision, revision);
    return;
  }
  invalidateAll();
  if (inFlight === 0 && revision > ownRevision) {
    ownRevision = revision;
    emitExternal();
  }
}

/** Opens the event stream. EventSource reconnects by itself; a reconnect re-sends the current revision. */
export function connectServerEvents(invalidateAll: () => void): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const source = new EventSource('/api/events');
  source.onmessage = (event) => {
    try {
      const { revision } = JSON.parse(event.data) as { revision: number };
      if (typeof revision === 'number') handleRevision(revision, invalidateAll);
    } catch {
      // ignore malformed messages
    }
  };
  return () => source.close();
}

/** Test helper. */
export function resetServerEvents(): void {
  inFlight = 0;
  ownRevision = 0;
  maxSeen = 0;
  connectedOnce = false;
  externalListeners.clear();
}
