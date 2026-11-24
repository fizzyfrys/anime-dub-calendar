import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeImport } from '../docs/library-data.js';

const ANILIST_QUERY = `query ($name: String!, $chunk: Int!) {
  MediaListCollection(userName: $name, type: ANIME, chunk: $chunk, perChunk: 500) {
    hasNextChunk
    lists { entries { mediaId status progress media { idMal } } }
  }
}`;
const MAL_STATUS = {
  watching: 'watching', completed: 'completed', on_hold: 'paused',
  dropped: 'dropped', plan_to_watch: 'planned',
};
const ANILIST_STATUS = {
  CURRENT: 'watching', COMPLETED: 'completed', PAUSED: 'paused',
  DROPPED: 'dropped', PLANNING: 'planned', REPEATING: 'rewatching',
};
const empty = () => ({ selected: [], watching: {} });
const MAX_RESPONSE = 2 * 1024 * 1024;

export function watchlistSettings(value, malAvailable) {
  if (value?.provider === 'off') return null;
  if (!['mal', 'anilist'].includes(value?.provider) || typeof value.username !== 'string' ||
      !/^[A-Za-z0-9_-]{1,40}$/.test(value.username) || (value.provider === 'mal' && !malAvailable)) {
    throw new Error('Invalid watchlist settings');
  }
  return { provider: value.provider, username: value.username };
}

async function upstreamJson(url, options, request, deadline) {
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(10_000)]);
  const response = await request(url, { ...options, redirect: 'error', signal });
  if (!response.ok || !response.body) throw new Error('Watchlist provider returned an error');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_RESPONSE) throw new Error('Watchlist response too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function fetchWatchlist({ provider, username }, { malClientId, request = fetch } = {}) {
  const rows = new Map();
  const deadline = AbortSignal.timeout(30_000);
  const save = (id, mal, aniList, status, progress) => {
    if (Number.isSafeInteger(id) && id > 0 && typeof status === 'string' &&
        Number.isSafeInteger(progress) && progress >= 0 && progress <= 10_000) {
      rows.set(id, { mal, aniList, status, progress });
    }
  };
  for (let page = 0; page < 20; page++) {
    if (provider === 'mal' && malClientId) {
      const url = new URL(`https://api.myanimelist.net/v2/users/${encodeURIComponent(username)}/animelist`);
      url.search = new URLSearchParams({ fields: 'list_status', limit: '500', offset: String(page * 500) });
      const data = await upstreamJson(url, { headers: { 'X-MAL-CLIENT-ID': malClientId } }, request, deadline);
      if (!Array.isArray(data?.data)) throw new Error('Invalid MyAnimeList response');
      for (const row of data.data) {
        const id = row?.node?.id;
        const list = row?.list_status;
        const status = list?.is_rewatching ? 'rewatching' : MAL_STATUS[list?.status];
        save(id, id, undefined, status, list?.num_episodes_watched);
      }
      if (!data.paging?.next) return [...rows.values()];
    } else if (provider === 'anilist') {
      const data = await upstreamJson('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: ANILIST_QUERY, variables: { name: username, chunk: page + 1 } }),
      }, request, deadline);
      const collection = data?.data?.MediaListCollection;
      if (data?.errors?.length || !Array.isArray(collection?.lists)) throw new Error('Invalid AniList response');
      for (const { entries } of collection.lists) {
        if (!Array.isArray(entries)) throw new Error('Invalid AniList entries');
        for (const { mediaId, media, status, progress } of entries) {
          save(mediaId, media?.idMal, mediaId, ANILIST_STATUS[status], progress);
        }
      }
      if (!collection.hasNextChunk) return [...rows.values()];
    } else {
      throw new Error('Watchlist provider is not configured');
    }
  }
  throw new Error('Watchlist exceeded the page limit');
}

export function applyWatchlist(profile, remote) {
  return {
    ...profile,
    selected: [...new Set([...profile.selected, ...remote.selected])],
    watching: { ...remote.watching, ...profile.watching },
  };
}

export async function createWatchlist({ data, getCatalog, getMetadata, malClientId, request }) {
  const path = join(data, 'watchlist-sync.json');
  let saved;
  try { saved = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let state = saved ?? { account: null, remote: empty() };
  let pending;
  let configurations = Promise.resolve();
  let configuring = false;
  let lastAttempt = 0;
  const info = () => ({ ...state, malAvailable: Boolean(malClientId) });

  async function persist(next) {
    const temp = `${path}.${randomUUID()}`;
    try {
      await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
      await rename(temp, path);
      state = next;
    } finally {
      await rm(temp, { force: true });
    }
  }

  function refresh(account = state.account) {
    if (pending) return pending;
    if (configuring || !account || Date.now() - lastAttempt < 60_000) return Promise.resolve(info());
    lastAttempt = Date.now();
    pending = (async () => {
      try {
        const [{ catalog }, metadata] = await Promise.all([getCatalog(), getMetadata()]);
        const rows = await fetchWatchlist(account, { malClientId, request });
        const { profile: remote } = mergeImport(empty(), rows, catalog, metadata);
        await persist({ account, remote, lastSync: new Date().toISOString() });
      } catch {
        await persist({ ...state, error: 'Could not refresh the watchlist. Check the username, visibility, and provider settings.' });
      }
      return info();
    })().finally(() => { pending = null; });
    return pending;
  }

  function configure(account) {
    const operation = configurations.then(async () => {
      configuring = true;
      try {
        if (pending) await pending;
        if (state.account?.provider !== account?.provider || state.account?.username !== account?.username) {
          await persist({ account, remote: empty() });
          lastAttempt = 0;
        }
      } finally {
        configuring = false;
      }
      return refresh();
    });
    configurations = operation.catch(() => {});
    return operation;
  }

  return { get: info, refresh, configure };
}
