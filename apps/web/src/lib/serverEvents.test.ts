import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectServerEvents,
  onExternalChange,
  resetServerEvents,
  trackedFetch,
} from './serverEvents';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(revision: number) {
    this.onmessage?.({ data: JSON.stringify({ revision }) });
  }
}

const fetchMock = vi.fn();
let invalidateAll: ReturnType<typeof vi.fn>;
let external: ReturnType<typeof vi.fn>;

function response(revision?: number): Response {
  return new Response('{}', {
    status: 200,
    headers: revision === undefined ? {} : { 'x-listify-revision': String(revision) },
  });
}

function connect() {
  const stop = connectServerEvents(invalidateAll as () => void);
  return { stop, source: FakeEventSource.instances.at(-1)! };
}

beforeEach(() => {
  resetServerEvents();
  FakeEventSource.instances = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
  invalidateAll = vi.fn();
  external = vi.fn();
  onExternalChange(external as () => void);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connectServerEvents', () => {
  it('opens /api/events and closes it on cleanup', () => {
    const { stop, source } = connect();
    expect(source.url).toBe('/api/events');
    stop();
    expect(source.closed).toBe(true);
  });

  it('does nothing where EventSource does not exist', () => {
    vi.stubGlobal('EventSource', undefined);
    expect(() => connectServerEvents(invalidateAll as () => void)()).not.toThrow();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('treats the first message as the baseline, not as a change', () => {
    const { source } = connect();
    source.emit(7);
    expect(invalidateAll).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
  });

  it('refreshes and reports an external change when someone else bumps the revision', () => {
    const { source } = connect();
    source.emit(3);
    source.emit(4);
    expect(invalidateAll).toHaveBeenCalledTimes(1);
    expect(external).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed messages', () => {
    const { source } = connect();
    source.onmessage?.({ data: 'not json' });
    expect(invalidateAll).not.toHaveBeenCalled();
  });

  it('after a reconnect, a higher revision counts as external (changes were missed)', () => {
    const { source } = connect();
    source.emit(3);
    source.emit(9); // what the server sends when EventSource reconnects
    expect(external).toHaveBeenCalledTimes(1);
  });
});

describe('own changes are not external', () => {
  it('our mutation: the event can arrive before the response and is still recognised as ours', async () => {
    const { source } = connect();
    source.emit(3); // baseline
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));

    const pending = trackedFetch('/api/tracks/x/assign', { method: 'POST' });
    source.emit(4); // server announces our own change first
    release(response(4));
    await pending;

    expect(invalidateAll).toHaveBeenCalled(); // still refreshes (cheap)
    expect(external).not.toHaveBeenCalled();
  });

  it('an event that arrives after our response is also ours', async () => {
    const { source } = connect();
    source.emit(3);
    fetchMock.mockResolvedValueOnce(response(4));
    await trackedFetch('/api/x', { method: 'POST' });

    source.emit(4);
    expect(external).not.toHaveBeenCalled();
  });

  it('several of our mutations in flight do not look like an external change', async () => {
    const { source } = connect();
    source.emit(3);
    const gates: ((r: Response) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>((r) => gates.push(r)));

    const a = trackedFetch('/api/a', { method: 'POST' });
    const b = trackedFetch('/api/b', { method: 'POST' });
    source.emit(4);
    source.emit(5);
    gates[0]!(response(4));
    await a;
    gates[1]!(response(5));
    await b;

    expect(external).not.toHaveBeenCalled();
  });

  it('GET requests are not tracked', async () => {
    const { source } = connect();
    source.emit(3);
    fetchMock.mockResolvedValueOnce(response());
    await trackedFetch('/api/library');
    source.emit(4);
    expect(external).toHaveBeenCalledTimes(1); // nothing of ours explains revision 4
  });
});

describe('someone else changes data while we are mid-mutation', () => {
  it('is reported once our mutation settles', async () => {
    const { source } = connect();
    source.emit(3);
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));

    const pending = trackedFetch('/api/x', { method: 'POST' });
    source.emit(5); // revision 4 was theirs, 5 is ours or later: ours answers with 4
    release(response(4));
    await pending;

    expect(external).toHaveBeenCalledTimes(1);
  });
});

describe('failures', () => {
  it('a rejected request releases the in-flight count', async () => {
    const { source } = connect();
    source.emit(3);
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(trackedFetch('/api/x', { method: 'POST' })).rejects.toThrow('network');

    source.emit(4);
    expect(external).toHaveBeenCalledTimes(1);
  });

  it('a listener can unsubscribe', () => {
    const { source } = connect();
    const other = vi.fn();
    const off = onExternalChange(other);
    off();
    source.emit(1);
    source.emit(2);
    expect(other).not.toHaveBeenCalled();
  });
});
