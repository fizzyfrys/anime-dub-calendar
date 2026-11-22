import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { titleKey } from './dub-calendar.js';

const source = 'https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json';
const maxBytes = 96 * 1024 * 1024;

export function selectMetadata(catalog, rows) {
  const byId = new Map(catalog.filter(show => show.malId).map(show => [show.malId, show.id]));
  const byTitle = new Map(catalog.filter(show => !show.malId).map(show => [titleKey(show.title), show.id]));
  const results = new Map();
  for (const row of rows) {
    if (!Array.isArray(row.sources) || typeof row.title !== 'string') continue;
    const ids = row.sources.map(url => typeof url === 'string' &&
      url.match(/^https:\/\/(myanimelist\.net|anilist\.co)\/anime\/(\d+)(?:\/|$)/)).filter(Boolean);
    const mal = ids.find(match => match[1] === 'myanimelist.net');
    const anilist = ids.find(match => match[1] === 'anilist.co');
    const direct = mal && byId.get(Number(mal[2]));
    const id = direct || byTitle.get(titleKey(row.title));
    if (!id) continue;
    // A title by itself is only a fallback, and ambiguous matches are omitted.
    if (results.has(id) && !direct) {
      results.set(id, null);
      continue;
    }
    const image = [row.thumbnail, row.picture].find(url => typeof url === 'string' &&
      /^https:\/\/(cdn\.myanimelist\.net|s4\.anilist\.co|media\.kitsu\.app)\//.test(url));
    results.set(id, {
      ...(image ? { image } : {}),
      ...(mal ? { malId: Number(mal[2]) } : {}),
      ...(anilist ? { aniListId: Number(anilist[2]) } : {}),
      tags: Array.isArray(row.tags)
        ? [...new Set(row.tags.filter(tag => typeof tag === 'string' && tag.length <= 80))].sort() : [],
    });
  }
  return Object.fromEntries([...results].filter(([, item]) => item));
}

async function fetchRows(request) {
  const response = await request(source, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`metadata download returned HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('metadata download exceeds size limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8')).data;
}

export async function refreshMetadata({ data, catalog, input, request = fetch, now = Date.now() }) {
  const cache = join(data, 'catalog-metadata.json');
  const showIds = catalog.map(show => show.id).sort();
  if (!input) {
    try {
      const previous = JSON.parse(await readFile(cache, 'utf8'));
      if (now - previous.updatedAt < 7 * 86_400_000 &&
          JSON.stringify(previous.showIds) === JSON.stringify(showIds)) return;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  const rows = input ? JSON.parse(await readFile(input, 'utf8')).data : await fetchRows(request);
  if (!Array.isArray(rows) || !rows.length) throw new Error('metadata download contains no shows');
  const temp = cache + '.tmp';
  try {
    await writeFile(temp, JSON.stringify({ updatedAt: now, showIds, shows: selectMetadata(catalog, rows) }));
    await rename(temp, cache);
  } finally {
    await rm(temp, { force: true });
  }
}
