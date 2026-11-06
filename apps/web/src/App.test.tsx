import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./organizer/Organizer', () => ({
  Organizer: ({ mode, onModeChange }: { mode: string; onModeChange: (m: 'triage') => void }) => (
    <div>
      ORGANIZER VIEW
      <span data-testid="mode">{mode}</span>
      <button onClick={() => onModeChange('triage')}>to-triage</button>
    </div>
  ),
}));

type Handler = (init?: RequestInit) => Response | Promise<Response>;

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Routes fetch calls by "METHOD /path"; anything unrouted fails the test loudly. */
function routeFetch(routes: Record<string, Handler>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unrouted fetch: ${key}`);
    return handler(init);
  });
}

const connectedRoutes: Record<string, Handler> = {
  'GET /api/health': () => jsonResponse({ status: 'ok' }),
  'GET /api/me': () => jsonResponse({ id: 'user1', displayName: 'Ada' }),
  'GET /api/playlists': () =>
    jsonResponse([
      { id: 'liked_songs', name: 'Liked Songs', ownerDisplayName: 'Ada', trackCount: 250 },
      { id: 'pl1', name: 'Big Mix', ownerDisplayName: 'Ada', trackCount: 900 },
      { id: 'pl2', name: 'Archive', ownerDisplayName: 'Ada', trackCount: 0 },
    ]),
  'GET /api/setup': () => jsonResponse({ mainSpotifyId: null, archiveSpotifyId: null }),
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('App: before connecting', () => {
  it('shows loading states while the API and Spotify checks are in flight', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<App />);
    expect(screen.queryByText('Checking API…')).not.toBeNull();
    expect(screen.queryByText('Checking Spotify connection…')).not.toBeNull();
  });

  it('offers a Connect button when Spotify answers 401', async () => {
    routeFetch({
      'GET /api/health': () => jsonResponse({ status: 'ok' }),
      'GET /api/me': () => jsonResponse({ error: 'not_connected' }, 401),
    });
    render(<App />);

    const link = await screen.findByRole('link', { name: 'Connect to Spotify' });
    expect(link.getAttribute('href')).toBe('/auth/login');
    expect(screen.queryByText('/api/health OK')).not.toBeNull();
  });

  it('reports an API outage and an unexpected health response', async () => {
    routeFetch({
      'GET /api/health': () => jsonResponse({}, 500),
      'GET /api/me': () => jsonResponse({}, 500),
    });
    render(<App />);

    // Both the health check and the Spotify check report the failure.
    await waitFor(() => expect(screen.queryAllByText('API error: HTTP 500')).toHaveLength(2));
  });

  it('flags a health response that is not "ok"', async () => {
    routeFetch({
      'GET /api/health': () => jsonResponse({ status: 'degraded' }),
      'GET /api/me': () => jsonResponse({ error: 'not_connected' }, 401),
    });
    render(<App />);
    await screen.findByText('API error: unexpected response');
  });

  it('reports a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));
    render(<App />);
    await waitFor(() => expect(screen.queryAllByText('API error: Failed to fetch').length).toBe(2));
  });

  it('shows the Spotify auth error from the redirect and removes it from the URL', async () => {
    window.history.replaceState({}, '', '/?auth_error=access_denied');
    routeFetch({
      'GET /api/health': () => jsonResponse({ status: 'ok' }),
      'GET /api/me': () => jsonResponse({}, 401),
    });

    render(<App />);

    await screen.findByText('Spotify connection failed: access_denied');
    expect(window.location.search).toBe('');
  });
});

describe('App: connected', () => {
  it('greets the user and starts on the Setup view', async () => {
    routeFetch(connectedRoutes);
    render(<App />);

    await screen.findByText('Connected as Ada');
    await screen.findByText('Main');
    expect(screen.queryByText('ORGANIZER VIEW')).toBeNull();
  });

  it('falls back to the Spotify id when there is no display name', async () => {
    routeFetch({
      ...connectedRoutes,
      'GET /api/me': () => jsonResponse({ id: 'user1', displayName: null }),
    });
    render(<App />);
    await screen.findByText('Connected as user1');
  });

  it('switches between Setup and Organize from the header', async () => {
    routeFetch(connectedRoutes);
    render(<App />);
    await screen.findByText('Connected as Ada');

    await userEvent.click(screen.getByRole('button', { name: 'Organize' }));
    expect(screen.queryByText('ORGANIZER VIEW')).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.queryByText('ORGANIZER VIEW')).toBeNull();
    await screen.findByText('Main');
  });

  it('has Setup, Organize, Triage and Sync tabs, with the active one marked', async () => {
    routeFetch(connectedRoutes);
    render(<App />);
    await screen.findByText('Connected as Ada');

    const nav = screen.getByRole('navigation', { name: 'Views' });
    expect(Array.from(nav.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Setup',
      'Organize',
      'Triage',
      'Sync',
    ]);
    expect(screen.getByRole('button', { name: 'Setup' }).getAttribute('aria-current')).toBe('page');

    await userEvent.click(screen.getByRole('button', { name: 'Triage' }));
    expect(screen.getByRole('button', { name: 'Triage' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('button', { name: 'Setup' }).getAttribute('aria-current')).toBeNull();
  });

  it('the Triage tab shows the workspace in triage mode, and the workspace can change the view', async () => {
    routeFetch(connectedRoutes);
    render(<App />);
    await screen.findByText('Connected as Ada');

    await userEvent.click(screen.getByRole('button', { name: 'Organize' }));
    expect(screen.getByTestId('mode').textContent).toBe('organize');

    await userEvent.click(screen.getByRole('button', { name: 'to-triage' }));
    expect(screen.getByTestId('mode').textContent).toBe('triage');
    expect(screen.getByRole('button', { name: 'Triage' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('still shows an auth error banner when already connected', async () => {
    window.history.replaceState({}, '', '/?auth_error=stale');
    routeFetch(connectedRoutes);
    render(<App />);
    await screen.findByText('Connected as Ada');
    expect(screen.queryByText('Spotify connection failed: stale')).not.toBeNull();
  });

  it('disconnects: posts to /auth/disconnect and returns to the Connect screen', async () => {
    const disconnect = vi.fn(() => new Response(null, { status: 204 }));
    routeFetch({ ...connectedRoutes, 'POST /auth/disconnect': disconnect });
    render(<App />);
    await screen.findByText('Connected as Ada');

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(disconnect).toHaveBeenCalledTimes(1);
    await screen.findByRole('link', { name: 'Connect to Spotify' });
  });

  it('shows an error and stays usable when disconnect fails', async () => {
    routeFetch({
      ...connectedRoutes,
      'POST /auth/disconnect': () => new Response('nope', { status: 500 }),
    });
    render(<App />);
    await screen.findByText('Connected as Ada');

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await screen.findByText('API error: HTTP 500');
  });
});

describe('App: Setup and Pull', () => {
  async function renderSetup(overrides: Record<string, Handler> = {}) {
    routeFetch({ ...connectedRoutes, ...overrides });
    render(<App />);
    await screen.findByText('Main');
  }

  function selects(): [HTMLSelectElement, HTMLSelectElement] {
    const [main, archive] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    return [main!, archive!];
  }

  it('lists Liked Songs and playlists with their track counts', async () => {
    await renderSetup();
    const [main] = selects();
    const labels = Array.from(main.options).map((o) => o.textContent);
    expect(labels).toEqual([
      'Choose a playlist…',
      'Liked Songs (250)',
      'Big Mix (900)',
      'Archive (0)',
    ]);
  });

  it('preselects the saved Main and Archive', async () => {
    await renderSetup({
      'GET /api/setup': () => jsonResponse({ mainSpotifyId: 'pl1', archiveSpotifyId: 'pl2' }),
    });
    const [main, archive] = selects();
    await waitFor(() => expect(main.value).toBe('pl1'));
    expect(archive.value).toBe('pl2');
  });

  it('keeps Save disabled until both are chosen, and Pull disabled until saved', async () => {
    await renderSetup();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const pull = screen.getByRole('button', { name: 'Pull' }) as HTMLButtonElement;
    const [main, archive] = selects();
    expect(save.disabled).toBe(true);
    expect(pull.disabled).toBe(true);

    await userEvent.selectOptions(main, 'Big Mix (900)');
    expect(save.disabled).toBe(true);
    await userEvent.selectOptions(archive, 'Archive (0)');
    expect(save.disabled).toBe(false);
    expect(pull.disabled).toBe(true);
  });

  it('saves the selection and then enables Pull', async () => {
    const saveHandler = vi.fn(() => jsonResponse({ status: 'ok' }));
    await renderSetup({ 'POST /api/setup': saveHandler });
    const [main, archive] = selects();
    await userEvent.selectOptions(main, 'Liked Songs (250)');
    await userEvent.selectOptions(archive, 'Archive (0)');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Pull' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    const init = (saveHandler.mock.calls[0] as unknown as [RequestInit])[0];
    expect(JSON.parse(init.body as string)).toEqual({
      mainSpotifyId: 'liked_songs',
      archiveSpotifyId: 'pl2',
      adopt: [],
    });
  });

  it('shows the error when saving fails and keeps Pull disabled', async () => {
    await renderSetup({ 'POST /api/setup': () => jsonResponse({ error: 'x' }, 400) });
    const [main, archive] = selects();
    await userEvent.selectOptions(main, 'Big Mix (900)');
    await userEvent.selectOptions(archive, 'Archive (0)');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('HTTP 400');
    expect((screen.getByRole('button', { name: 'Pull' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('pulls and then moves on to the Organizer', async () => {
    const pullHandler = vi.fn(() =>
      jsonResponse({
        mainTrackCount: 10,
        archiveTrackCount: 2,
        subPlaylists: [],
        skippedEpisodes: 0,
      }),
    );
    await renderSetup({
      'GET /api/setup': () => jsonResponse({ mainSpotifyId: 'pl1', archiveSpotifyId: 'pl2' }),
      'POST /api/setup': () => jsonResponse({ status: 'ok' }),
      'POST /api/sync/pull': pullHandler,
    });
    await waitFor(() => expect(selects()[0].value).toBe('pl1'));

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pull' }));

    await screen.findByText('ORGANIZER VIEW');
    expect(pullHandler).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding unapplied local assignments, and pulls anyway on request', async () => {
    const pulls: string[] = [];
    routeFetch({
      ...connectedRoutes,
      'POST /api/setup': () => jsonResponse({ status: 'ok' }),
      'POST /api/sync/pull': () => {
        pulls.push('first');
        return jsonResponse(
          {
            error: 'pending_local_changes',
            message: 'Pull would discard 3 local assignment(s).',
            pending: [
              { playlistId: 1, name: 'Road', count: 2 },
              { playlistId: 2, name: 'Gym', count: 1 },
            ],
          },
          409,
        );
      },
      'POST /api/sync/pull?force=true': () => {
        pulls.push('forced');
        return jsonResponse({
          mainTrackCount: 1,
          archiveTrackCount: 0,
          subPlaylists: [],
          skippedEpisodes: 0,
        });
      },
    });
    render(<App />);
    await screen.findByText('Connected as Ada');
    const [mainSelect, archiveSelect] = await screen.findAllByRole('combobox');
    await userEvent.selectOptions(mainSelect!, 'pl1');
    await userEvent.selectOptions(archiveSelect!, 'pl2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pull' }));

    await screen.findByText('Pull would discard 3 local assignment(s).');
    expect(pulls).toEqual(['first']);
    expect(screen.queryByText('ORGANIZER VIEW')).toBeNull();

    await userEvent.click(
      screen.getByRole('button', { name: /Pull anyway \(discard 3 local assignments\)/ }),
    );

    await screen.findByText('ORGANIZER VIEW');
    expect(pulls).toEqual(['first', 'forced']);
  });

  it('surfaces the server message when the pull fails (e.g. setup required)', async () => {
    await renderSetup({
      'GET /api/setup': () => jsonResponse({ mainSpotifyId: 'pl1', archiveSpotifyId: 'pl2' }),
      'POST /api/setup': () => jsonResponse({ status: 'ok' }),
      'POST /api/sync/pull': () =>
        jsonResponse({ error: 'rate_limited', message: 'Spotify quota exceeded' }, 503),
    });
    await waitFor(() => expect(selects()[0].value).toBe('pl1'));

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pull' }));

    await screen.findByText('Spotify quota exceeded');
    expect(screen.queryByText('ORGANIZER VIEW')).toBeNull();
  });

  it('shows the error instead of spinning forever when playlists fail to load', async () => {
    routeFetch({
      ...connectedRoutes,
      'GET /api/playlists': () => jsonResponse({ error: 'reconnect_required' }, 401),
    });
    render(<App />);

    await screen.findByText('Could not load playlists: HTTP 401');
    expect(screen.queryByText('Loading playlists…')).toBeNull();
  });
});
