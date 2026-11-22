import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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

export async function loadFeedToken(data, legacyKey) {
  const path = join(data, 'personal-feed-token');
  try {
    const saved = (await readFile(path, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/.test(saved)) throw new Error('Invalid stored personal feed token');
    return saved;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = legacyKey
    ? createHmac('sha256', legacyKey).update('anime-dubs-feed-v1').digest('hex')
    : randomBytes(32).toString('hex');
  await writeFile(path, token, { flag: 'wx', mode: 0o600 });
  return token;
}

export function createPersonalRoutes({ password, legacyKey, token, data, getCatalog }) {
  if (!password && !legacyKey) return null;
  const key = hash(password || legacyKey);
  const feedPath = `./personal.ics?token=${token}`;
  const profilePath = join(data, 'personal-profile.json');
  const valid = (value, digest) => typeof value === 'string' && timingSafeEqual(hash(value), digest);
  const feedDigest = hash(token);
  const sessionKey = randomBytes(32);
  const signSession = payload => createHmac('sha256', sessionKey).update(payload).digest('hex');
  const sessionAge = 7 * 24 * 60 * 60;
  let failures = 0;
  let retryAt = 0;
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

  async function readJson(request, limit) {
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
      throw Object.assign(new Error('Expected JSON'), { status: 415 });
    }
    if (Number(request.headers['content-length']) > limit) {
      throw Object.assign(new Error('Request is too large'), { status: 413 });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error('Request is too large'), { status: 413 });
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  return async (request, response, url) => {
    if (url.pathname === '/api/session') {
      const cookie = (value, age) => ({
        'Set-Cookie': `calendar_session=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${age}` +
          (request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''),
        'Cache-Control': 'no-store',
      });
      if (request.method === 'DELETE') return response.writeHead(204, cookie('', 0)).end();
      if (request.method !== 'POST') return response.writeHead(405, { Allow: 'POST, DELETE' }).end();
      let credentials;
      try {
        credentials = await readJson(request, 4096);
      } catch (error) {
        return json(response, error.status ?? 400, { error: 'Invalid sign-in request' }, { Connection: 'close' });
      }
      const now = Date.now();
      if (now < retryAt) {
        return json(response, 429, { error: 'Too many attempts' }, { 'Retry-After': Math.ceil((retryAt - now) / 1000) });
      }
      if (!valid(credentials?.password, key)) {
        if (++failures >= 5) {
          failures = 0;
          retryAt = now + 30_000;
        }
        return json(response, 401, { error: 'Incorrect password' });
      }
      failures = 0;
      const payload = `${now + sessionAge * 1000}.${randomUUID()}`;
      return response.writeHead(204, cookie(`${payload}.${signSession(payload)}`, sessionAge)).end();
    }

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

    const session = request.headers.cookie?.match(/(?:^|;\s*)calendar_session=(\d{13}\.[a-f0-9-]{36})\.([a-f0-9]{64})(?:;|$)/);
    const signedIn = session && Number(session[1].split('.')[0]) > Date.now() &&
      valid(session[2], hash(signSession(session[1])));
    const legacy = !password && valid(request.headers.authorization?.match(/^Bearer (.+)$/)?.[1], key);
    if (!signedIn && !legacy) {
      return json(response, 401, { error: 'Sign in to access your profile' });
    }
    if (request.method === 'GET') return sendProfile(response, await load());
    if (request.method !== 'PUT') return response.writeHead(405, { Allow: 'GET, PUT' }).end();
    const expected = request.headers['if-match'];
    if (!expected) return json(response, 428, { error: 'Profile version required' });
    let profile;
    try {
      profile = normalizeProfile(await readJson(request, MAX_PROFILE_BYTES));
    } catch (error) {
      return json(response, error.status ?? 400, { error: 'Invalid profile' },
        error.status === 413 ? { Connection: 'close' } : undefined);
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
