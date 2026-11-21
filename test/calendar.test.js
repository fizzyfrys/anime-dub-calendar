import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyReleaseTimes, countDubReleases, parseDubCalendar, titleKey, updateDubCalendar } from '../src/dub-calendar.js';
import { computeEpisodeEvents } from '../src/cour-logic.js';
import { generateIcs } from '../src/generate-ics.js';
import { parseForumHtml } from '../src/parse.js';

const instant = '2026-11-02T02:30:00Z';
const day = date => new Date(`${date}T12:00:00Z`);
const dubRow = (title, number, platforms, time = instant) =>
  `<li><time datetime="${time}">ignored display time</time><strong>${title}</strong>
    <span>Episode ${number}</span><span class="awc-seo-services">${platforms}</span></li>`;
const dubPage = (...rows) => `<section class="awc-seo-day"><ul>${rows.join('')}</ul></section>`;

const malShow = (name, ep, note = '') => `<li><a href="https://myanimelist.net/anime/1">${name}</a> (Episodes: ${ep}/12)${note}</li>`;
const malPage = ({ shows = malShow('Sample Season 2', 2), updated = 'November 1, 2026',
  annotations = '', premieres = '' } = {}) => `
  <div id="msg53221626">Last Updated: <b>${updated}</b><br>
    <b>Currently Streaming SimulDubbed Anime - 4</b><br>
    <ul><li>Sunday<ul>${shows}</ul>${annotations}</li></ul><br>
    <b>Upcoming SimulDubbed Anime for Fall</b><br>
    <ul>${premieres || '<li>Future Show - November 8, 2026*<br>* - Not confirmed.</li>'}</ul>
  </div>`;

describe('English Dubbed releases', () => {
  test('reads the published instant, not the displayed clock, and requires an explicit offset', () => {
    const rows = parseDubCalendar(dubPage(
      dubRow('Sample', 2, '<a href="#">Crunchyroll</a>, YouTube', '2026-11-01T18:30:00-08:00'),
      dubRow('No Zone', 2, 'Netflix', '2026-11-01T18:30:00'),
    ));
    expect(rows[0]).toEqual({
      title: 'Sample', episodeNumber: 2, startsAt: '2026-11-02T02:30:00.000Z',
      platforms: ['crunchyroll', 'youtube'],
    });
    expect(rows[1].startsAt).toBeNull();
    expect(countDubReleases(rows)).toBe(1);
    expect(countDubReleases(parseDubCalendar('<main>Unexpected markup</main>'))).toBe(0);
  });

  test('keeps exclusions and eligible times through an outage, but uses fresh corrections', () => {
    const current = parseDubCalendar(dubPage(
      dubRow('Mixed', 2, 'YouTube, Crunchyroll'),
      dubRow('Ocean &amp; More', 2, 'OceanVeil, Crunchyroll'),
      dubRow('Only Video', 2, 'YouTube, YouTube (Dub)'),
    ));
    const state = updateDubCalendar(current, {}, day('2026-11-02'));
    expect(state.excluded).toEqual(['ocean more', 'only video']);
    expect(state.releases.map(r => r.title)).toEqual(['Mixed']);
    expect(updateDubCalendar([], state, day('2026-11-03'))).toEqual(state);

    const fresh = parseDubCalendar(dubPage(
      dubRow('Mixed', 2, 'Netflix', '2026-11-02T03:30:00Z'),
      dubRow('Only Video', 3, 'YouTube, Disney+'),
    ));
    const next = updateDubCalendar(fresh, state, day('2026-11-04'));
    expect(next.excluded).toEqual(['ocean more']);
    expect(next.releases[0].startsAt).toBe('2026-11-02T03:30:00.000Z');
    expect(updateDubCalendar([], next, day('2027-04-01')).releases).toEqual([]);
  });

  test('merges title variants by episode, not across seasons', () => {
    expect(titleKey('Ranma ½ (2024) 3rd Season')).toBe(titleKey('Ranma 1/2 Season 3'));
    const mal = { title: 'Sample Season 2', episodeNumber: 2, date: day('2026-11-01'),
      malUrl: 'https://myanimelist.net/anime/1', isProjected: true };
    const releases = parseDubCalendar(dubPage(
      dubRow('Sample 2nd Season', 2, 'Netflix'),
      dubRow('Sample 3rd Season', 2, 'Netflix'),
    ));
    const merged = applyReleaseTimes([mal], [], releases);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      title: mal.title, malUrl: mal.malUrl, releaseAt: new Date(instant),
      date: day('2026-11-01'), isProjected: false,
    });
    expect(merged[1].title).toBe('Sample 3rd Season');
  });
});

describe('MAL dates and history', () => {
  test('reads the list under each header and separates premiere footnotes', () => {
    const schedule = parseForumHtml(malPage({
      shows: malShow('Sample Season 2', 2, '++') + malShow('Platform Note', 1, ' (OceanVeil)'),
      annotations: '<br>++ = Dub production suspended until November 9, 2026.',
    }));
    expect(schedule.currentlyStreaming[0].resumeDate).toBe('November 9, 2026');
    expect(schedule.currentlyStreaming[1].platformExcluded).toBe(true);
    expect(schedule.upcomingSimulDubbed).toMatchObject([{
      title: 'Future Show', premiereDate: '2026-11-08', dateConfirmed: false,
    }]);
    expect(() => parseForumHtml('<div class="forum-topic-message">Missing schedule</div>')).toThrow('active episode counts');
  });

  test('keeps saved dates; projections follow the latest timed episode, not the stale MAL count', () => {
    const show = parseForumHtml(malPage()).currentlyStreaming[0];
    const events = computeEpisodeEvents(show, {}, day('2026-11-09'), day('2026-11-09'),
      { 1: '2026-10-18', 2: '2026-10-25' }, new Map([[3, day('2026-11-07')]]));
    expect(events.slice(0, 3).map(e => [e.episodeNumber, e.date, e.isProjected])).toEqual([
      [1, day('2026-10-18'), false],
      [2, day('2026-10-25'), false],
      [4, day('2026-11-15'), true],
    ]);
  });

  test('includes every episode in a fresh batch drop, not just the last two', () => {
    const show = parseForumHtml(malPage({ shows: malShow('Sample Season 2', 6) })).currentlyStreaming[0];
    const events = computeEpisodeEvents(show, { 'sample-season-2': { lastEp: 2 } },
      day('2026-11-01'), day('2026-11-01'), { 2: '2026-10-25' });
    expect(events.slice(0, 4).map(e => [e.episodeNumber, e.date, e.isMultiDrop])).toEqual(
      [3, 4, 5, 6].map(ep => [ep, day('2026-11-01'), true]),
    );
  });

  test('keeps all-day estimates for episodes without published times before and between timed releases', () => {
    const show = parseForumHtml(malPage()).currentlyStreaming[0];
    const events = computeEpisodeEvents(show, {}, day('2026-11-01'), day('2026-11-01'), {},
      new Map([[4, day('2026-11-06')], [6, day('2026-11-22')]]));
    expect(events.filter(e => e.isProjected).slice(0, 3).map(e => [e.episodeNumber, e.date])).toEqual([
      [3, day('2026-11-06')],
      [5, day('2026-11-15')],
      [7, day('2026-11-29')],
    ]);
  });
});

test('the timed event keeps the existing UID and custom title format', () => {
  const event = { title: 'Sample', episodeNumber: 1, date: day('2026-11-01'),
    malUrl: 'https://myanimelist.net/anime/1' };
  const allDay = generateIcs([event], 'November 1, 2026');
  const timed = generateIcs([{ ...event, releaseAt: new Date(instant) }], 'November 1, 2026',
    { titleFormat: 'ep-first' }).replace(/\r\n /g, '');
  const uid = 'UID:mal-dub-sample-ep-1@anime-dub-cal';
  expect(allDay).toContain(uid);
  expect(allDay).toContain('DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102');
  expect(timed).toContain(uid);
  expect(timed).toContain('DTSTART:20261102T023000Z\r\n');
  expect(timed).not.toContain('DTEND');
  expect(timed).toContain('SUMMARY:Ep 1 · Sample');
  expect(timed).toContain('anime/1\\nRelease time:');
});

test('both feed variants and the website data agree on filtering and local-input fallback', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'anime-dub-test-'));
  try {
    const offset = new Date();
    const today = offset.toISOString().slice(0, 10);
    const nextMonth = new Date(+offset + 30 * 86_400_000).toLocaleDateString('en-US', {
      timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
    });
    const malPath = path.join(dir, 'mal.html');
    const dubPath = path.join(dir, 'dub.html');
    const summaryPath = path.join(dir, 'run-summary.md');
    writeFileSync(malPath, malPage({
      updated: offset.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }),
      shows: malShow('Sample Season 2', 2) + malShow('Hide Me', 2) +
        malShow('Other Hidden', 2) + malShow('On Hold', 1, '++'),
      annotations: `<br>++ = Resumes ${nextMonth}`,
    }));
    writeFileSync(dubPath, dubPage(
      dubRow('Sample 2nd Season', 2, 'Netflix', `${today}T10:00:00Z`),
      dubRow('Hide Me', 2, 'YouTube, YouTube (Dub)', `${today}T10:30:00Z`),
      dubRow('Other Hidden', 2, 'OceanVeil, BiliBili TV', `${today}T11:00:00Z`),
      dubRow('On Hold', 2, 'Netflix', `${today}T11:00:00Z`),
      dubRow('Source Only', 4, 'HIDIVE', `${today}T11:30:00Z`),
    ));
    const run = (tz, extra) => execFileSync(process.execPath,
      ['src/index.js', '--local', malPath, '--output-dir', dir, ...extra],
      { env: { ...process.env, TZ: tz, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryPath },
        stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    const read = name => readFileSync(path.join(dir, name), 'utf8');
    run('America/Los_Angeles', ['--dub-calendar', dubPath]);
    const before = read('anime-dubs.ics').replace(/^DTSTAMP:.+\r\n/gm, '');
    run('Pacific/Kiritimati', []);
    const after = read('anime-dubs.ics').replace(/^DTSTAMP:.+\r\n/gm, '');
    expect(after).toBe(before);
    for (const name of ['anime-dubs.ics', 'anime-dubs-ep-first.ics']) {
      const feed = read(name);
      expect(feed).not.toMatch(/hide-me|other-hidden/i);
      expect(feed).toContain('UID:mal-dub-source-only-ep-4@anime-dub-cal');
      expect(feed.match(/^DTSTART:/gm)).toHaveLength(2);
      expect(feed).toContain('DTSTART;VALUE=DATE:20261108');
    }
    const schedule = JSON.parse(read('schedule.json'));
    expect(schedule.shows.map(s => s.title)).toEqual(['Sample Season 2', 'On Hold']);
    expect(schedule.releases.map(r => r.title)).toEqual(['Sample Season 2', 'Source Only']);

    writeFileSync(dubPath, '<main>The upstream markup changed</main>');
    expect(run('UTC', ['--dub-calendar', dubPath])).toMatch(/::warning .*parsed 0 usable releases \(last healthy run: 5\)/);
    writeFileSync(dubPath, dubPage(dubRow('Hide Me', 2, 'Netflix', `${today}T10:30:00Z`)));
    expect(run('UTC', ['--dub-calendar', dubPath])).toMatch(/::warning .*parsed 1 usable releases \(last healthy run: 5\)/);
    expect(read('run-summary.md')).toContain('Publishing MAL and cached release times');
    expect(JSON.parse(read('state.json')).dubCalendar.lastHealthyRowCount).toBe(5);
    expect(read('anime-dubs.ics').replace(/^DTSTAMP:.+\r\n/gm, '')).toBe(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
