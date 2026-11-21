import { parse } from 'node-html-parser';

export const DUB_CALENDAR_URL = 'https://english-dubbed.com/anime-industry/english-dub-anime-calendar/';
const DAY_MS = 86_400_000;
const broadcastDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});

function normalizeTitle(title) {
  return title.normalize('NFKD').toLowerCase()
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .replace(/\b(\d+)(?:st|nd|rd|th)\s+season\b/g, 'season $1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Verified alternate names; don't guess across subtitles, years, or seasons.
const aliases = new Map([
  ['Saga of Tanya the Evil II', 'Saga of Tanya the Evil Season 2'],
  ['Reincarnated as a Sword 2', 'Reincarnated as a Sword Season 2'],
  ['Magic Knight Rayearth (2026)', 'Magic Knight Rayearth'],
  ['The Prince of Tennis II U-17 WORLD CUP: The Final Tryouts', 'The Prince of Tennis II U-17 WORLD CUP: Final Member Selection Match'],
  ["JoJo's Bizarre Adventure: Steel Ball Run 2nd - 3rd STAGE", "Jojo's Bizarre Adventure Part 7: STEEL BALL RUN"],
  ['Tokyo Revengers: War of the Three Titans Arc', 'Tokyo Revengers: War of the Three Titan Arc'],
  ['Rilakkuma: Goyururi Yume no Tabi', 'Rilakkuma'],
  ['Magical Explorer: Reborn as a Side Character in a Fantasy Dating Sim', 'Magical Explorer'],
  ['Ranma ½ (2024) 3rd Season', 'Ranma 1/2 Season 3'],
].map(([alternate, title]) => [normalizeTitle(alternate), normalizeTitle(title)]));

export function titleKey(title) {
  const key = normalizeTitle(title);
  return aliases.get(key) ?? key;
}

function episodeKey(title, episodeNumber) {
  return JSON.stringify([titleKey(title), episodeNumber]);
}

export async function fetchDubCalendar() {
  const response = await fetch(DUB_CALENDAR_URL, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseDubCalendar(await response.text());
}

export function parseDubCalendar(html) {
  const rows = [];
  for (const item of parse(html).querySelectorAll('.awc-seo-day > ul > li')) {
    const title = item.querySelector('strong')?.text.trim();
    if (!title) continue;
    const episodeNumber = Number(item.querySelector('span:not(.awc-seo-services)')?.text.trim().match(/^Episode\s+(\d+)$/i)?.[1]);
    const datetime = item.querySelector('time[datetime]')?.getAttribute('datetime') ?? '';
    const startsAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/i.test(datetime)
      ? new Date(datetime) : null;
    const platforms = item.querySelector('.awc-seo-services')?.text.split(',')
      .map(name => name.toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean) ?? [];
    rows.push({
      title, episodeNumber, platforms,
      startsAt: startsAt && Number.isFinite(+startsAt) ? startsAt.toISOString() : null,
    });
  }
  if (!rows.some(row => row.startsAt && row.platforms.length && row.episodeNumber > 0)) {
    throw new Error('No recognizable releases in the English Dubbed calendar');
  }
  return rows;
}

export function updateDubCalendar(rows, previous, referenceDate) {
  const excluded = new Set(previous.excluded ?? []);
  const platformsByTitle = new Map();
  for (const row of rows) {
    if (!row.platforms.length) continue;
    const key = titleKey(row.title);
    platformsByTitle.set(key, [...(platformsByTitle.get(key) ?? []), ...row.platforms]);
  }
  for (const [key, platforms] of platformsByTitle) {
    if (platforms.some(p => /\bocean\s*veil\b/.test(p)) ||
        platforms.every(p => /^youtube\b/.test(p))) {
      excluded.add(key);
    } else {
      excluded.delete(key);
    }
  }

  const releases = new Map();
  for (const row of [...(previous.releases ?? []), ...rows]) {
    if (!row.startsAt || !Number.isSafeInteger(row.episodeNumber) || row.episodeNumber < 1 ||
        excluded.has(titleKey(row.title)) || !row.platforms.length) continue;
    const instant = Date.parse(row.startsAt);
    if (!Number.isFinite(instant) || instant < +referenceDate - 120 * DAY_MS) continue;
    const key = episodeKey(row.title, row.episodeNumber);
    releases.set(key, row);
  }
  return { excluded: [...excluded].sort(), releases: [...releases.values()] };
}

export function broadcastDate(startsAt) {
  const parts = Object.fromEntries(broadcastDateFormat.formatToParts(new Date(startsAt))
    .map(({ type, value }) => [type, value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
}

export function applyReleaseTimes(events, shows, releases) {
  const showsByTitle = new Map(shows.map(show => [titleKey(show.title), show]));
  const byEpisode = new Map(events.map(event => [episodeKey(event.title, event.episodeNumber), event]));

  for (const { title, episodeNumber, startsAt } of releases) {
    const key = episodeKey(title, episodeNumber);
    const existing = byEpisode.get(key);
    const show = existing ?? showsByTitle.get(titleKey(title));
    byEpisode.set(key, {
      ...existing,
      title: show?.title ?? title,
      malUrl: show?.malUrl ?? '',
      episodeNumber,
      date: broadcastDate(startsAt),
      releaseAt: new Date(startsAt),
      isProjected: false,
      dateConfirmed: true,
    });
  }

  return [...byEpisode.values()];
}
