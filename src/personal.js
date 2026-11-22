import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateIcs } from './generate-ics.js';

const MAX_PROFILE_BYTES = 128 * 1024;
const showId = /^(?:mal-[1-9]\d{0,8}|title-[a-f0-9]{24})$/;
const statuses = new Set(['watching', 'planned', 'completed', 'paused', 'dropped', 'rewatching']);
const hash = value => createHash('sha256').update(value).digest();
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);

function normalizeList(value, accept, length) {
  if (!Array.isArray(value) || value.length > length || !value.every(accept)) {
    throw new Error('Invalid profile filters');
  }
  return [...new Set(value)];
}

export function normalizeProfile(value) {
  if (!isRecord(value)) throw new Error('Invalid profile');
  const { onlySelected = false, selected = [], hidden = [], platforms = [], watching = {} } = value;
  if (typeof onlySelected !== 'boolean' || !isRecord(watching) || Object.keys(watching).length > 1000) {
    throw new Error('Invalid watch progress');
  }
  for (const [id, item] of Object.entries(watching)) {
    if (!showId.test(id) || !isRecord(item) || !Number.isSafeInteger(item.progress) ||
        item.progress < 0 || item.progress > 10000 || (item.status && !statuses.has(item.status))) {
      throw new Error('Invalid watch progress');
    }
  }
  const validId = id => typeof id === 'string' && showId.test(id);
  return {
    onlySelected,
    selected: normalizeList(selected, validId, 1000),
    hidden: normalizeList(hidden, validId, 1000),
    platforms: normalizeList(platforms, platform => typeof platform === 'string' &&
      platform.length > 0 && platform.length <= 100 && !/[\x00-\x1f]/.test(platform), 50),
    watching: Object.fromEntries(Object.entries(watching).map(([id, { status, progress }]) =>
      [id, { status: status || '', progress }])),
  };
}

export function personalFeed(schedule, profile, compact = false) {
  const selected = new Set(profile.selected);
  const hidden = new Set(profile.hidden);
  const platforms = new Set(profile.platforms);
  const events = [];
  for (const show of schedule.catalog ?? []) {
    const ids = [show.id, ...(show.aliases ?? [])];
    if (ids.some(id => hidden.has(id)) || (profile.onlySelected && !ids.some(id => selected.has(id)))) continue;
    for (const episode of show.episodes) {
      const services = episode.platforms.length ? episode.platforms : show.platforms;
      if (platforms.size && !services.some(platform => platforms.has(platform))) continue;
      const { startsAt, date, ...event } = episode;
      events.push({
        ...event, title: event.title ?? show.title,
        malUrl: show.malId ? `https://myanimelist.net/anime/${show.malId}` : '',
        date: new Date(date + 'T00:00:00Z'),
        ...(startsAt ? { releaseAt: new Date(startsAt) } : {}),
      });
    }
  }
  events.sort((a, b) => (a.releaseAt ?? a.date) - (b.releaseAt ?? b.date));
  return generateIcs(events, schedule.lastUpdated ?? 'unknown', {
    titleFormat: compact ? 'ep-first' : 'title-first',
    calendarName: 'My Anime Dubs',
    dtstamp: new Date(schedule.generatedAt),
  });
}

export function createPersonalRoutes({ secret, data, getCatalog }) {
  if (!secret) return null;
  const key = hash(secret);
  const token = createHmac('sha256', secret).update('anime-dubs-feed-v1').digest('hex');
  const feedPath = `./personal.ics?token=${token}`;
  const profilePath = join(data, 'personal-profile.json');
  const valid = (value, digest) => typeof value === 'string' && timingSafeEqual(hash(value), digest);
  const feedDigest = hash(token);
  let lastWrite = Promise.resolve();
  const version = profile => `"${hash(JSON.stringify(profile)).toString('hex')}"`;
  const json = (response, status, body, headers) => response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  }).end(JSON.stringify(body));

  async function load() {
    try {
      return normalizeProfile(JSON.parse(await readFile(profilePath, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return normalizeProfile({});
      throw error;
    }
  }

  function sendProfile(response, profile) {
    return json(response, 200, { profile, feedPath }, { ETag: version(profile) });
  }

  return async (request, response, url) => {
    if (url.pathname === '/personal.ics') {
      if (!valid(url.searchParams.get('token'), feedDigest)) return response.writeHead(404).end();
      if (!['GET', 'HEAD'].includes(request.method)) {
        return response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      }
      const schedule = await getCatalog();
      if (!Array.isArray(schedule.catalog)) return response.writeHead(503, { 'Retry-After': '60' }).end();
      const body = personalFeed(schedule, await load(), url.searchParams.get('format') === 'compact');
      return response.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'private, no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      }).end(request.method === 'HEAD' ? undefined : body);
    }

    if (!valid(request.headers.authorization?.match(/^Bearer (.+)$/)?.[1], key)) {
      return json(response, 401, { error: 'Invalid calendar access key' });
    }
    if (request.method === 'GET') return sendProfile(response, await load());
    if (request.method !== 'PUT') return response.writeHead(405, { Allow: 'GET, PUT' }).end();
    const expected = request.headers['if-match'];
    if (!expected) return json(response, 428, { error: 'Profile version required' });
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
      return json(response, 415, { error: 'Expected JSON' });
    }
    if (Number(request.headers['content-length']) > MAX_PROFILE_BYTES) {
      return json(response, 413, { error: 'Profile is too large' }, { Connection: 'close' });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > MAX_PROFILE_BYTES) return json(response, 413, { error: 'Profile is too large' }, { Connection: 'close' });
      chunks.push(chunk);
    }
    let profile;
    try {
      profile = normalizeProfile(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      return json(response, 400, { error: 'Invalid profile' });
    }
    const write = lastWrite.then(async () => {
      if (version(await load()) !== expected) return json(response, 412, { error: 'Profile changed' });
      const temp = `${profilePath}.${randomUUID()}`;
      try {
        await writeFile(temp, JSON.stringify(profile), { mode: 0o600 });
        await rename(temp, profilePath);
      } finally {
        await rm(temp, { force: true });
      }
      return sendProfile(response, profile);
    });
    lastWrite = write.catch(() => {});
    return write;
  };
}
