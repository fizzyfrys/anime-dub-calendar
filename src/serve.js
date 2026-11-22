import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCalendarPublish } from './publish.js';
import { createPersonalRoutes } from './personal.js';
import { refreshMetadata } from './metadata.js';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const web = fileURLToPath(new URL('../web/', import.meta.url));
const builder = fileURLToPath(new URL('./index.js', import.meta.url));
const data = '/data';
const staging = join(data, '.staging');
const feeds = ['anime-dubs.ics', 'anime-dubs-ep-first.ics'];
const schedule = 'schedule.json';
const state = 'state.json';
const outputs = [...feeds, schedule, state];
const catalog = 'catalog.json';
const getCatalog = async () => JSON.parse(await readFile(join(data, catalog), 'utf8'));
const keyFile = process.env.CALENDAR_ACCESS_KEY_FILE;
const key = keyFile ? (await readFile(keyFile, 'utf8')).trim() : '';
if (keyFile && (key.length < 32 || !/^[\x21-\x7e]+$/.test(key))) {
  throw new Error('CALENDAR_ACCESS_KEY_FILE must contain at least 32 characters without spaces');
}
const personal = createPersonalRoutes({ secret: key, data, getCatalog });
const libraryFiles = new Map([
  ['/', ['library.html', 'text/html']],
  ['/library.html', ['library.html', 'text/html']],
  ['/library.css', ['library.css', 'text/css']],
  ['/library.js', ['library.js', 'text/javascript']],
  ['/library-data.js', ['library-data.js', 'text/javascript']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/calendar-icon.svg', ['calendar-icon.svg', 'image/svg+xml']],
  ['/calendar-icon-192.png', ['calendar-icon-192.png', 'image/png']],
  ['/calendar-icon-512.png', ['calendar-icon-512.png', 'image/png']],
  ['/calendar-sw.js', ['calendar-sw.js', 'text/javascript']],
]);
const routes = new Map([
  ['/', ['index.html', 'text/html', false]],
  ['/index.html', ['index.html', 'text/html', false]],
  ['/feed-url.js', ['feed-url.js', 'text/javascript', false]],
  ['/' + schedule, [schedule, 'application/json', true]],
  ...feeds.map(file => ['/' + file, [file, 'text/calendar', true]]),
]);

async function withBundledFallback(file, operation) {
  try {
    return await operation(join(data, file));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return operation(join(docs, file));
  }
}

async function refresh(publishedState) {
  await mkdir(staging, { recursive: true });
  try {
    const stagedState = join(staging, state);
    if (publishedState) await writeFile(stagedState, publishedState);
    else await withBundledFallback(state, from => copyFile(from, stagedState));
    const args = [builder, '--output-dir', staging];
    if (personal) {
      args.push('--self-hosted');
      await copyFile(join(data, catalog), join(staging, catalog)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    if (process.env.MAL_HTML_PATH) args.push('--local', process.env.MAL_HTML_PATH);
    if (process.env.DUB_CALENDAR_HTML_PATH) args.push('--dub-calendar', process.env.DUB_CALENDAR_HTML_PATH);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { stdio: 'inherit' });
      child.once('error', reject);
      child.once('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`calendar build exited with ${code ?? 'a signal'}`));
      });
    });
    for (const file of personal ? [...outputs, catalog] : outputs) {
      await rename(join(staging, file), join(data, file));
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function refreshDaily() {
  try {
    const { GITHUB_PUBLISH_REPOSITORY: repository, GITHUB_PUBLISH_TOKEN_FILE: tokenFile } = process.env;
    let sync;
    if (repository || tokenFile) {
      try {
        sync = await prepareCalendarPublish({ repository, tokenFile });
      } catch (error) {
        console.error('[calendar-server] Could not read published history; skipping GitHub publish:', error.message);
      }
    }
    await refresh(sync?.state);
    if (personal && process.env.CALENDAR_METADATA !== 'off') {
      void getCatalog().then(schedule => refreshMetadata({
        data, catalog: schedule.catalog, input: process.env.CALENDAR_METADATA_PATH,
      })).catch(error => console.warn('[calendar-server] Show metadata unavailable:', error.message));
    }
    if (sync) {
      try {
        const sha = await sync.publish(data, outputs);
        console.log(sha
          ? `[calendar-server] Published feeds to ${repository}@${sha}`
          : '[calendar-server] Feeds already published');
      } catch (error) {
        console.error('[calendar-server] GitHub publish failed; local feeds updated:', error.message);
      }
    }
  } catch (error) {
    console.error('[calendar-server] Refresh failed:', error.message);
  }
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(10, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  console.log(`[calendar-server] Next refresh: ${next.toISOString()}`);
  setTimeout(refreshDaily, next - now);
}

const server = createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  if (personal && (path === '/api/profile' || path === '/personal.ics')) {
    try {
      await personal(request, response, new URL(request.url, 'http://localhost'));
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('[calendar-server] Personal calendar request failed:', error.code || error.name);
      if (!response.headersSent) {
        response.writeHead(error.code === 'ENOENT' ? 503 : 500, { 'Cache-Control': 'no-store' }).end();
      }
    }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const asset = personal && libraryFiles.get(path);
  const localData = personal && [`/${catalog}`, '/catalog-metadata.json'].includes(path)
    ? [path.slice(1), 'application/json', true] : null;
  const route = asset || localData || routes.get(path);
  if (!route) {
    response.writeHead(404).end();
    return;
  }
  const [file, type, generated] = route;
  try {
    const body = localData ? await readFile(join(data, file)) :
      generated ? await withBundledFallback(file, readFile) : await readFile(join(asset ? web : docs, file));
    response.writeHead(200, {
      'Content-Type': `${type}; charset=utf-8`,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...(asset ? { 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" } : {}),
    }).end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (localData && error.code === 'ENOENT') {
      response.writeHead(file === catalog ? 503 : 404, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    console.error('[calendar-server] Could not serve', file, error.message);
    response.writeHead(500).end();
  }
});

server.listen(8080, '0.0.0.0', () => {
  console.log('[calendar-server] Listening on port 8080');
  void refreshDaily();
});
