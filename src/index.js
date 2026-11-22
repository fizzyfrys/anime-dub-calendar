/**
 * index.js — Pipeline orchestrator
 *
 * Usage:
 *   node src/index.js                          # fetch both live sources
 *   node src/index.js --local <mal.html> --dub-calendar <dub.html> --output-dir <dir>
 */

import { fetchAndParse, parseCivilDate } from './parse.js';
import { computeEpisodeEvents, computeUpcomingEvents, makeSlug } from './cour-logic.js';
import { applyReleaseTimes, broadcastDate, countDubReleases, fetchDubCalendar, parseDubCalendar, titleKey, updateDubCalendar } from './dub-calendar.js';
import { generateIcs } from './generate-ics.js';
import { buildCatalog } from './catalog.js';
import { appendFile, readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`);
  return value;
}

const DOCS_DIR = argValue('--output-dir') ?? path.join(ROOT, 'docs');
const ICS_PATH = path.join(DOCS_DIR, 'anime-dubs.ics');
const ICS_EP_FIRST_PATH = path.join(DOCS_DIR, 'anime-dubs-ep-first.ics');
const SCHEDULE_PATH = path.join(DOCS_DIR, 'schedule.json');
const STATE_PATH = path.join(DOCS_DIR, 'state.json');

const localPath = argValue('--local');
const dubCalendarPath = argValue('--dub-calendar');

async function warnDubCalendar(reason) {
  const message = `English Dubbed calendar: ${reason}. Publishing MAL and cached release times; check the secondary source.`;
  console.warn(`[anime-dub-cal] ${message}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const annotation = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::warning title=English Dubbed calendar degraded::${annotation}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Secondary calendar warning\n\n${message}\n`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[anime-dub-cal] ${localPath ? `Parsing local file: ${localPath}` : 'Fetching live from MAL...'}`);

  // 1. Fetch both sources; the supplemental calendar should not take down MAL.
  const dubInput = dubCalendarPath ? readFile(dubCalendarPath, 'utf8').then(parseDubCalendar)
    : localPath ? null : fetchDubCalendar();
  const [schedule, dubFetch] = await Promise.all([
    fetchAndParse(localPath),
    dubInput?.then(rows => ({ rows }), error => ({ error })),
  ]);
  console.log(`[anime-dub-cal] Last Updated: ${schedule.lastUpdated}`);
  console.log(`[anime-dub-cal] Currently streaming: ${schedule.currentlyStreaming.length} shows`);
  console.log(`[anime-dub-cal] Upcoming premiere entries: ${schedule.upcomingSimulDubbed.length}`);

  // 2. Load previous state & persistent history
  let prevState = { shows: {}, history: {}, dubCalendar: {} };
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, 'utf8'));
    prevState = {
      shows: parsed.shows ?? (parsed.history ? {} : parsed),
      history: parsed.history ?? {},
      dubCalendar: parsed.dubCalendar ?? {},
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // 3. Compute episode events
  const referenceDate = new Date();
  let lastHealthyRowCount = prevState.dubCalendar.lastHealthyRowCount;
  let dubRows = [];
  if (dubFetch) {
    const count = countDubReleases(dubFetch.rows ?? []);
    if (dubFetch.error) {
      await warnDubCalendar(`fetch failed (${dubFetch.error.message})`);
    } else if (count === 0 || count < lastHealthyRowCount / 2) {
      const baseline = lastHealthyRowCount ? ` (last healthy run: ${lastHealthyRowCount})` : '';
      await warnDubCalendar(`parsed ${count} usable releases${baseline}`);
    } else {
      dubRows = dubFetch.rows;
      lastHealthyRowCount = count;
    }
  }
  const dubCalendar = updateDubCalendar(dubRows, prevState.dubCalendar, referenceDate);
  if (lastHealthyRowCount) dubCalendar.lastHealthyRowCount = lastHealthyRowCount;
  const excluded = new Set(dubCalendar.excluded);
  for (const show of [...schedule.currentlyStreaming, ...schedule.upcomingSimulDubbed]) {
    if (show.platformExcluded) excluded.add(titleKey(show.title));
  }
  const include = show => !excluded.has(titleKey(show.title));
  const streaming = schedule.currentlyStreaming.filter(include);
  const upcoming = schedule.upcomingSimulDubbed.filter(include);
  const malShows = [...upcoming, ...streaming];
  const malByTitle = new Map(malShows.map(show => [titleKey(show.title), show]));
  const releases = dubCalendar.releases.filter(release => {
    if (!include(release)) return false;
    const show = malByTitle.get(titleKey(release.title));
    if (!show) return true;
    const day = broadcastDate(release.startsAt);
    if (release.episodeNumber > show.currentEp) {
      if (show.suspended || (show.resumeDate && day < parseCivilDate(show.resumeDate))) return false;
    }
    return !show.premiereDate || !show.dateConfirmed || release.episodeNumber !== 1 ||
      day.toISOString().slice(0, 10) === show.premiereDate;
  });
  const verifiedDates = new Map();
  for (const release of releases) {
    const key = titleKey(release.title);
    if (!verifiedDates.has(key)) verifiedDates.set(key, new Map());
    verifiedDates.get(key).set(release.episodeNumber, broadcastDate(release.startsAt));
  }
  const malEvents = [];

  // 3a. Currently streaming shows
  for (const show of streaming) {
    const slug = makeSlug(show.title);
    const showHistory = prevState.history[slug] || {};
    const events = computeEpisodeEvents(show, prevState.shows, referenceDate,
      schedule.lastUpdatedDate, showHistory, verifiedDates.get(titleKey(show.title)));

    // Merge any previously recorded historical episodes from past runs
    const existingEpisodes = new Set(events.map(e => e.episodeNumber));
    for (const [epStr, dateStr] of Object.entries(showHistory)) {
      const epNum = Number(epStr);
      if (!existingEpisodes.has(epNum) && epNum <= show.currentEp) {
        events.push({
          title: show.title,
          malUrl: show.malUrl,
          episodeNumber: epNum,
          date: new Date(dateStr + 'T12:00:00Z'),
          isProjected: false,
          isMultiDrop: false,
        });
      }
    }

    malEvents.push(...events);
  }

  // 3b. Upcoming premieres — only if not already in the currently streaming list
  const streamingTitles = new Set(streaming.map(s => titleKey(s.title)));
  for (const show of upcoming) {
    if (streamingTitles.has(titleKey(show.title))) continue;
    malEvents.push(...computeUpcomingEvents(show));
  }

  const allEvents = applyReleaseTimes(malEvents, malShows, releases);
  allEvents.sort((a, b) => (a.releaseAt ?? a.date) - (b.releaseAt ?? b.date) || a.episodeNumber - b.episodeNumber);

  console.log(`[anime-dub-cal] Total calendar events generated: ${allEvents.length}`);

  // 4. Generate ICS feeds (both standard Title - Ep and Ep · Title formats)
  const icsDefault = generateIcs(allEvents, schedule.lastUpdated, {
    titleFormat: 'title-first',
    calendarName: 'Anime Dubs Schedule',
  });
  const icsEpFirst = generateIcs(allEvents, schedule.lastUpdated, {
    titleFormat: 'ep-first',
    calendarName: 'Anime Dubs (Ep First)',
  });

  // 5. Save new state (record current episode counts + persistent history per show)
  const newShows = {};
  const newHistory = { ...prevState.history };

  for (const show of streaming) {
    const slug = makeSlug(show.title);
    newShows[slug] = {
      lastEp: show.currentEp,
      lastSeen: referenceDate.toISOString(),
      title: show.title,
    };

  }
  for (const event of allEvents) {
    const slug = makeSlug(event.title);
    if (!newShows[slug] || event.episodeNumber > newShows[slug].lastEp || event.isProjected) continue;
    const dates = (newHistory[slug] ??= {});
    const date = event.date.toISOString().slice(0, 10);
    if (event.releaseAt) dates[event.episodeNumber] = date;
    else dates[event.episodeNumber] ??= date;
  }

  const newState = {
    shows: newShows,
    history: newHistory,
    dubCalendar,
  };

  // 6. Write output files
  const recentReleases = allEvents.filter(e => e.releaseAt && Math.abs(e.releaseAt - referenceDate) <= 7 * 86_400_000);
  await mkdir(DOCS_DIR, { recursive: true });
  await writeFile(ICS_PATH, icsDefault, 'utf8');
  await writeFile(ICS_EP_FIRST_PATH, icsEpFirst, 'utf8');
  await writeFile(STATE_PATH, JSON.stringify(newState, null, 2), 'utf8');
  await writeFile(SCHEDULE_PATH, JSON.stringify({
    generatedAt: referenceDate.toISOString(),
    lastUpdated: schedule.lastUpdated,
    showCount: new Set([...streaming, ...recentReleases].map(e => titleKey(e.title))).size,
    eventCount: allEvents.length,
    shows: streaming.map(s => ({
      title: s.title,
      day: s.day,
      currentEp: s.currentEp,
      totalEp: s.totalEp,
      suspended: s.suspended,
      resumeDate: s.resumeDate,
    })),
    releases: recentReleases.map(e => ({
      title: e.title, episodeNumber: e.episodeNumber, startsAt: e.releaseAt.toISOString(),
    })),
  }, null, 2), 'utf8');
  if (args.includes('--self-hosted')) {
    const catalogPath = path.join(DOCS_DIR, 'catalog.json');
    const previous = await readFile(catalogPath, 'utf8').then(
      contents => JSON.parse(contents).catalog,
      error => { if (error.code !== 'ENOENT') throw error; },
    );
    await writeFile(catalogPath, JSON.stringify({
      generatedAt: referenceDate.toISOString(),
      lastUpdated: schedule.lastUpdated,
      catalog: buildCatalog(allEvents, streaming, releases, previous, excluded, referenceDate),
    }), 'utf8');
  }

  console.log(`[anime-dub-cal] ✓ Written: ${ICS_PATH} (Default: Title - Ep ##)`);
  console.log(`[anime-dub-cal] ✓ Written: ${ICS_EP_FIRST_PATH} (Compact: Ep ## · Title)`);
  console.log(`[anime-dub-cal] ✓ Written: ${SCHEDULE_PATH}`);
  console.log(`[anime-dub-cal] ✓ Written: ${STATE_PATH}`);
}

main().catch(err => {
  console.error('[anime-dub-cal] Fatal error:', err);
  process.exit(1);
});
