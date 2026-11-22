import { civilDay } from './calendar-week.js';
export { civilDay, localDay, weekDays } from './calendar-week.js';

const malStatus = {
  Watching: 'watching', Completed: 'completed', 'On-Hold': 'paused',
  Dropped: 'dropped', 'Plan to Watch': 'planned',
};
const aniListStatus = {
  CURRENT: 'watching', COMPLETED: 'completed', PAUSED: 'paused',
  DROPPED: 'dropped', PLANNING: 'planned', REPEATING: 'rewatching',
};

export function isReleased(episode, now) {
  return !episode.isProjected && !episode.isResumeEvent &&
    (!episode.isPremierePlaceholder || episode.dateConfirmed) &&
    (episode.startsAt ? Date.parse(episode.startsAt) <= +now : episode.date <= civilDay(now));
}

export const profileIds = show => [show.id, ...(show.aliases ?? [])];
export const hasShow = (list, show) => profileIds(show).some(id => list.includes(id));

export function includesEpisode(profile, show, episode) {
  return !profile || (!hasShow(profile.hidden, show) &&
    (!profile.onlySelected || hasShow(profile.selected, show)) &&
    (!profile.platforms.length || (episode.platforms.length ? episode.platforms : show.platforms)
      .some(platform => profile.platforms.includes(platform))));
}

export function watchProgress(profile, show) {
  return profileIds(show).map(id => profile?.watching[id]).find(Boolean) ?? { status: '', progress: 0 };
}

export async function readImport(file) {
  const limit = 5 * 1024 * 1024;
  if (file.size > limit) throw new Error('Watchlist file exceeds 5 MB.');
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzip = magic[0] === 0x1f && magic[1] === 0x8b;
  if (!gzip) return file.text();
  if (typeof DecompressionStream === 'undefined') throw new Error('Unzip the export and select the XML file.');
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.length;
      if (size > limit) throw new Error('Expanded watchlist exceeds 5 MB.');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

export function parseImport(text, XmlParser = globalThis.DOMParser) {
  let rows;
  if (text.trimStart().startsWith('<')) {
    const doc = new XmlParser().parseFromString(text, 'application/xml');
    if (doc.documentElement.localName !== 'myanimelist' || doc.querySelector('parsererror')) {
      throw new Error('Choose a MyAnimeList anime export or an AniList JSON export.');
    }
    rows = [...doc.querySelectorAll('myanimelist > anime')].map(row => {
      const read = tag => row.querySelector(tag)?.textContent.trim();
      return { mal: Number(read('series_animedb_id')), status: malStatus[read('my_status')],
        progress: Number(read('my_watched_episodes')) };
    });
  } else {
    const json = JSON.parse(text);
    const collection = json?.data?.MediaListCollection ?? json?.MediaListCollection ?? json;
    const entries = Array.isArray(collection) ? collection :
      Array.isArray(collection?.lists) ? collection.lists.flatMap(list => list.entries ?? []) : collection?.entries;
    if (!Array.isArray(entries) || collection?.hasNextChunk) {
      throw new Error('Choose a complete AniList anime list JSON export.');
    }
    rows = entries.filter(row => row && (row.media?.type ?? 'ANIME') === 'ANIME').map(row => ({
      mal: row.media?.idMal ?? row.idMal,
      aniList: row.media?.id ?? row.mediaId,
      status: aniListStatus[row.status], progress: row.progress,
    }));
  }
  const valid = id => Number.isSafeInteger(id) && id > 0;
  return rows.filter(row => (valid(row.mal) || valid(row.aniList)) &&
    Object.values(aniListStatus).includes(row.status) &&
    Number.isSafeInteger(row.progress) && row.progress >= 0 && row.progress <= 10000);
}

export function mergeImport(profile, rows, catalog, metadata) {
  const match = new Map();
  const mal = new Map();
  const aniList = new Map();
  for (const show of catalog) {
    const m = metadata[show.id] ?? {};
    if (show.malId || m.malId) {
      const id = show.malId || m.malId;
      if (!mal.has(id) || show.malId) mal.set(id, show.id);
    }
    if (m.aniListId && (!aniList.has(m.aniListId) || show.malId)) aniList.set(m.aniListId, show.id);
  }
  for (const { mal: malId, aniList: anilistId, status, progress } of rows) {
    const id = mal.get(malId) ?? aniList.get(anilistId);
    if (id) match.set(id, { status, progress });
  }
  const chosen = [...match].filter(([, { status }]) => !['completed', 'dropped'].includes(status))
    .map(([id]) => id);
  return {
    matched: match.size,
    profile: { ...profile, selected: [...new Set([...profile.selected, ...chosen])],
      watching: { ...profile.watching, ...Object.fromEntries(match) } },
  };
}
