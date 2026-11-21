import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const builder = fileURLToPath(new URL('./index.js', import.meta.url));
const data = '/data';
const staging = join(data, '.staging');
const feeds = ['anime-dubs.ics', 'anime-dubs-ep-first.ics'];
const schedule = 'schedule.json';
const state = 'state.json';
const outputs = [...feeds, schedule, state];
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

async function refresh() {
  await mkdir(staging, { recursive: true });
  try {
    await withBundledFallback(state, from => copyFile(from, join(staging, state)));
    const args = [builder, '--output-dir', staging];
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
    for (const file of outputs) await rename(join(staging, file), join(data, file));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function refreshDaily() {
  try {
    await refresh();
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
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const route = routes.get(request.url.split('?')[0]);
  if (!route) {
    response.writeHead(404).end();
    return;
  }
  const [file, type, generated] = route;
  try {
    const body = generated ? await withBundledFallback(file, readFile) : await readFile(join(docs, file));
    response.writeHead(200, {
      'Content-Type': `${type}; charset=utf-8`,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    }).end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error('[calendar-server] Could not serve', file, error.message);
    response.writeHead(500).end();
  }
});

server.listen(8080, '0.0.0.0', () => {
  console.log('[calendar-server] Listening on port 8080');
  void refreshDaily();
});
