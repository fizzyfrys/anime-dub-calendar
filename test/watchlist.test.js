import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import { applyWatchlist, createWatchlist, fetchWatchlist, watchlistSettings } from '../src/watchlist.js';

test('MAL client ID is sent only to MAL, even when upstream returns an external next URL', async () => {
  const request = jest.fn()
    .mockResolvedValueOnce(Response.json({ data: [
      { node: { id: 12 }, list_status: { status: 'watching', num_episodes_watched: 4 } },
    ], paging: { next: 'https://untrusted.example/path' } }))
    .mockResolvedValueOnce(Response.json({ data: [] }));
  const rows = await fetchWatchlist({ provider: 'mal', username: 'sample-user' }, { malClientId: 'fixture-id', request });
  expect(rows).toEqual([{ mal: 12, aniList: undefined, status: 'watching', progress: 4 }]);
  expect(request.mock.calls.map(([url]) => [url.hostname, url.pathname, url.searchParams.get('offset')])).toEqual([
    ['api.myanimelist.net', '/v2/users/sample-user/animelist', '0'],
    ['api.myanimelist.net', '/v2/users/sample-user/animelist', '500'],
  ]);
  expect(request.mock.calls.every(([, options]) =>
    options.redirect === 'error' && options.headers['X-MAL-CLIENT-ID'] === 'fixture-id')).toBe(true);
  expect(() => watchlistSettings({ provider: 'mal', username: '..//host' }, true)).toThrow();
});

test('AniList uses public GraphQL pagination, no credentials, and no notes or scores', async () => {
  const chunk = (entries, hasNextChunk) => Response.json({ data: { MediaListCollection: { lists: [{ entries }], hasNextChunk } } });
  const request = jest.fn()
    .mockResolvedValueOnce(chunk([{ mediaId: 20, media: { idMal: 12 }, status: 'COMPLETED', progress: 4 }], true))
    .mockResolvedValueOnce(chunk([{ mediaId: 21, status: 'PLANNING', progress: 0 }], false));
  const rows = await fetchWatchlist({ provider: 'anilist', username: 'demo' }, { malClientId: 'not-used', request });
  expect(rows).toEqual([
    { mal: 12, aniList: 20, status: 'completed', progress: 4 },
    { mal: undefined, aniList: 21, status: 'planned', progress: 0 },
  ]);
  for (const [[url, options], index] of request.mock.calls.map((call, index) => [call, index])) {
    expect(url).toBe('https://graphql.anilist.co');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body).variables).toEqual({ name: 'demo', chunk: index + 1 });
    expect(options.body).not.toMatch(/notes|score|not-used/);
  }
});

test('sync stores only catalog matches, retains them on error, and keeps local overrides', async () => {
  const data = await mkdtemp(join(tmpdir(), 'calendar-watchlist-'));
  const request = jest.fn().mockResolvedValueOnce(Response.json({ data: [
    { node: { id: 12 }, list_status: { status: 'watching', num_episodes_watched: 4 } },
    { node: { id: 13 }, list_status: { status: 'plan_to_watch', num_episodes_watched: 0 } },
  ] })).mockRejectedValueOnce(new Error('sensitive provider detail'));
  const create = () => createWatchlist({
    data, request, malClientId: 'fixture-id',
    getCatalog: async () => ({ catalog: [{ id: 'mal-12', malId: 12 }] }),
    getMetadata: async () => ({}),
  });
  try {
    const watchlist = await create();
    const saved = await watchlist.configure({ provider: 'mal', username: 'demo' });
    expect(saved.remote).toEqual({ selected: ['mal-12'], watching: { 'mal-12': { status: 'watching', progress: 4 } } });
    const manual = {
      hidden: ['mal-12'], selected: ['mal-90'], onlySelected: true,
      watching: { 'mal-12': { status: 'watching', progress: 5 } },
    };
    expect(applyWatchlist(manual, saved.remote)).toEqual({ ...manual, selected: ['mal-90', 'mal-12'] });
    const restarted = await create();
    expect(await restarted.refresh()).toMatchObject({ remote: saved.remote, lastSync: saved.lastSync });
    const persisted = await readFile(join(data, 'watchlist-sync.json'), 'utf8');
    expect(persisted).not.toMatch(/mal-13|fixture-id|sensitive provider detail/);
    expect((await restarted.configure(null)).remote).toEqual({ selected: [], watching: {} });
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
