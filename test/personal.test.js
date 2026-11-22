import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { buildCatalog } from '../src/catalog.js';
import { selectMetadata } from '../src/metadata.js';
import { normalizeProfile, personalFeed } from '../src/personal.js';
import { includesEpisode, isReleased, mergeImport, parseImport, readImport } from '../docs/library-data.js';
import { groupWeek, weekDays } from '../docs/calendar-week.js';

const generatedAt = '2026-11-22T15:00:00Z';
const date = new Date('2026-11-22T12:00:00Z');
const startsAt = '2026-11-22T10:00:00Z';
const malUrl = 'https://myanimelist.net/anime/123/Container_Test';
const event = { title: 'Container Test', malUrl, date, episodeNumber: 2, releaseAt: new Date(startsAt) };
const active = [{ title: event.title, malUrl, currentEp: 2, totalEp: 12 }];
const dub = [{ title: event.title, episodeNumber: 2, platforms: ['crunchyroll'] }];

test('catalog keeps release times and archives only recorded past episodes', () => {
  const upcoming = { ...event, releaseAt: undefined, date: new Date('2026-11-29T12:00:00Z'),
    episodeNumber: 3, isProjected: true };
  const live = buildCatalog([event, upcoming], active, dub);
  expect(live).toMatchObject([{ id: 'mal-123', airing: true, platforms: ['crunchyroll'],
    episodes: [{ date: '2026-11-22', episodeNumber: 2, startsAt: '2026-11-22T10:00:00.000Z' },
      { date: '2026-11-29', episodeNumber: 3, isProjected: true }] }]);
  const archive = buildCatalog([], [], [], live, new Set(), new Date(generatedAt));
  expect(archive).toMatchObject([{ id: 'mal-123', airing: false, episodes: [{ episodeNumber: 2 }] }]);
  expect(buildCatalog([], [], [], live, new Set(['container test']), new Date(generatedAt))).toEqual([]);
});

test('hide takes precedence over selected and persists when the title gains a MAL ID', () => {
  const previous = buildCatalog([{ ...event, malUrl: '' }], [], dub);
  const catalog = buildCatalog([event, { ...event, episodeNumber: 1, releaseAt: undefined }],
    active, dub, previous, new Set(), new Date(generatedAt));
  const profile = normalizeProfile({ selected: ['mal-123'], onlySelected: true, hidden: [previous[0].id] });
  expect(includesEpisode(profile, catalog[0], catalog[0].episodes[0])).toBe(false);
  const schedule = { catalog, generatedAt };
  expect(personalFeed(schedule, profile)).not.toContain('BEGIN:VEVENT');
  const restored = personalFeed(schedule, { ...profile, hidden: [], platforms: ['crunchyroll'] });
  expect(restored).toContain('UID:mal-dub-container-test-ep-2@anime-dub-cal');
  expect(restored).toContain('DTSTART:20261122T100000Z');
  expect(restored).toContain('DTSTART;VALUE=DATE:20261122');
  expect(personalFeed(schedule, { ...profile, hidden: [], platforms: ['netflix'] })).not.toContain('BEGIN:VEVENT');
});

test('profile validates inputs and copies only the allowed fields', () => {
  expect(normalizeProfile({ hidden: ['mal-123', 'mal-123'], secret: 'discard' })).toEqual({
    onlySelected: false, selected: [], hidden: ['mal-123'], platforms: [], watching: {},
  });
  expect(() => normalizeProfile({ watching: { 'mal-123': { status: 'wrong', progress: 2 } } })).toThrow();
  expect(() => normalizeProfile({ hidden: ['other'] })).toThrow();
});

test('an English Dubbed release keeps its MAL identity after the show leaves the forum list', () => {
  const earlier = { ...event, episodeNumber: 1, releaseAt: undefined, date: new Date('2026-11-15T12:00:00Z') };
  const previous = buildCatalog([earlier, event], active, dub);
  const catalog = buildCatalog([{ ...event, malUrl: '' }], [], dub, previous, new Set(), new Date(generatedAt));
  expect(catalog).toMatchObject([{ id: 'mal-123', airing: false,
    episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] }]);
  expect(catalog).toHaveLength(1);
  const schedule = { catalog, generatedAt };
  expect(personalFeed(schedule, normalizeProfile({ hidden: ['mal-123'] }))).not.toContain('BEGIN:VEVENT');
});

test('live metadata matches by MAL ID and AniList import brings in progress without undoing hides', async () => {
  const catalog = buildCatalog([event], active, dub);
  const metadata = selectMetadata(catalog, [{
    title: 'Alternate Title',
    sources: ['https://myanimelist.net/anime/123', 'https://anilist.co/anime/200'],
    picture: 'https://cdn.myanimelist.net/images/anime/example.jpg',
    tags: ['comedy', 'action', 'action'],
  }]);
  expect(metadata['mal-123']).toMatchObject({ aniListId: 200, tags: ['action', 'comedy'],
    image: 'https://cdn.myanimelist.net/images/anime/example.jpg' });
  const text = JSON.stringify({ data: { MediaListCollection: { lists: [{ entries: [
    { status: 'CURRENT', progress: 1, mediaId: 200 },
    { status: 'CURRENT', progress: 2, media: { idMal: 123, type: 'MANGA' } },
    { status: 'COMPLETED', progress: 2, mediaId: 400 },
  ] }] } } });
  expect(await readImport(new Blob([gzipSync(text)]))).toBe(text);
  const imported = mergeImport(normalizeProfile({ hidden: ['mal-123'] }), parseImport(text), catalog, metadata);
  expect(imported).toMatchObject({ matched: 1, profile: {
    selected: ['mal-123'], hidden: ['mal-123'], watching: { 'mal-123': { progress: 1, status: 'watching' } },
  } });
});

test('local dates cross midnight and DST; estimates or early releases do not count as watched backlog', () => {
  const value = execFileSync(process.execPath, ['--input-type=module', '-e', [
    "import { localDay, weekDays } from './docs/calendar-week.js';",
    "console.log(localDay({ date:'2026-11-01', startsAt:'2026-11-01T03:00:00Z' }));",
    "console.log(localDay({ date:'2026-11-01' }));",
    "console.log(weekDays(new Date('2026-10-31T20:00:00Z'), 0).slice(0, 4).join(','));",
  ].join('\n')], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
  expect(value.trim()).toBe('2026-10-31\n2026-11-01\n2026-10-31,2026-11-01,2026-11-02,2026-11-03');
  expect(isReleased({ startsAt }, new Date('2026-11-22T09:59:00Z'))).toBe(false);
  expect(isReleased({ startsAt, isProjected: true }, new Date(generatedAt))).toBe(false);
  expect(isReleased({ startsAt }, new Date(generatedAt))).toBe(true);
});

test('the calendar always includes seven dates and does not move untimed episodes', () => {
  const days = weekDays(new Date(2026, 11, 28, 10));
  const title = 'Example';
  const row = { title, episode: { episodeNumber: 1, date: '2026-12-31' } };
  const groups = groupWeek(days, [row, { title, episode: { episodeNumber: 2, date: '2027-01-04' } }]);
  expect([...groups.keys()]).toEqual([
    '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
  ]);
  expect(groups.get('2026-12-31')).toEqual([row]);
  expect(groups.get('2027-01-03')).toEqual([]);
});
