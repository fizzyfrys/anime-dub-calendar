/**
 * index.js — Pipeline orchestrator
 *
 * Usage:
 *   node src/index.js                          # fetch live from MAL
 *   node src/index.js --local <path-to-html>   # parse local HTML file
 */

import { fetchAndParse } from './parse.js';
import { computeEpisodeEvents, computeUpcomingEvents, getBroadcastWeekDate, makeSlug } from './cour-logic.js';
import { generateIcs } from './generate-ics.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const ICS_PATH = path.join(DOCS_DIR, 'anime-dubs.ics');
const ICS_EP_FIRST_PATH = path.join(DOCS_DIR, 'anime-dubs-ep-first.ics');
const SCHEDULE_PATH = path.join(DOCS_DIR, 'schedule.json');
const STATE_PATH = path.join(DOCS_DIR, 'state.json');

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const localIndex = args.indexOf('--local');
const localPath = localIndex !== -1 ? args[localIndex + 1] : null;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[anime-dub-cal] ${localPath ? `Parsing local file: ${localPath}` : 'Fetching live from MAL...'}`);

  // 1. Parse the forum HTML
  const schedule = await fetchAndParse(localPath);
  console.log(`[anime-dub-cal] Last Updated: ${schedule.lastUpdated}`);
  console.log(`[anime-dub-cal] Currently streaming: ${schedule.currentlyStreaming.length} shows`);
  console.log(`[anime-dub-cal] Upcoming premiere entries: ${schedule.upcomingSimulDubbed.length}`);

  // 2. Load previous state & persistent history
  let prevState = { shows: {}, history: {} };
  if (existsSync(STATE_PATH)) {
    try {
      const parsed = JSON.parse(await readFile(STATE_PATH, 'utf8'));
      if (parsed.history || parsed.shows) {
        prevState = { shows: parsed.shows || {}, history: parsed.history || {} };
      } else {
        // Migration from legacy flat format
        prevState = { shows: parsed, history: {} };
      }
    } catch {
      console.warn('[anime-dub-cal] Could not parse state.json, starting fresh.');
    }
  }

  // 3. Compute episode events
  const referenceDate = new Date();
  const allEvents = [];

  // 3a. Currently streaming shows
  for (const show of schedule.currentlyStreaming) {
    const slug = makeSlug(show.title);
    const events = computeEpisodeEvents(show, prevState.shows, referenceDate, schedule.lastUpdatedDate);

    // Merge any previously recorded historical episodes from past runs
    const showHistory = prevState.history[slug] || {};
    for (const [epStr, dateStr] of Object.entries(showHistory)) {
      const epNum = parseInt(epStr, 10);
      if (!events.some(e => e.episodeNumber === epNum)) {
        events.push({
          title: show.title,
          malUrl: show.malUrl,
          episodeNumber: epNum,
          date: new Date(dateStr + 'T12:00:00'),
          isProjected: false,
          isMultiDrop: false,
        });
      }
    }

    allEvents.push(...events);
  }

  // 3b. Upcoming premieres — only if not already in the currently streaming list
  const streamingTitles = new Set(schedule.currentlyStreaming.map(s => makeSlug(s.title)));
  for (const upcoming of schedule.upcomingSimulDubbed) {
    if (!upcoming.premiereDate) continue;
    if (streamingTitles.has(makeSlug(upcoming.title))) continue; // already in streaming
    const events = computeUpcomingEvents(upcoming);
    allEvents.push(...events);
  }

  // Sort events by date, then by episode number
  allEvents.sort((a, b) => a.date - b.date || a.episodeNumber - b.episodeNumber);

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

  for (const show of schedule.currentlyStreaming) {
    const slug = makeSlug(show.title);
    newShows[slug] = {
      lastEp: show.currentEp,
      lastSeen: new Date().toISOString(),
      title: show.title,
    };

    if (!newHistory[slug]) newHistory[slug] = {};
    if (show.currentEp > 0) {
      const currentEpDate = getBroadcastWeekDate(show.day, schedule.lastUpdatedDate, referenceDate);
      newHistory[slug][show.currentEp] = currentEpDate.toISOString().split('T')[0];

      // Keep previous week in history
      if (show.currentEp > 1) {
        const prevWeekDate = new Date(currentEpDate);
        prevWeekDate.setDate(currentEpDate.getDate() - 7);
        newHistory[slug][show.currentEp - 1] = prevWeekDate.toISOString().split('T')[0];
      }
    }
  }

  const newState = {
    shows: newShows,
    history: newHistory,
  };

  // 6. Write output files
  await mkdir(DOCS_DIR, { recursive: true });
  await writeFile(ICS_PATH, icsDefault, 'utf8');
  await writeFile(ICS_EP_FIRST_PATH, icsEpFirst, 'utf8');
  await writeFile(STATE_PATH, JSON.stringify(newState, null, 2), 'utf8');
  await writeFile(SCHEDULE_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    lastUpdated: schedule.lastUpdated,
    showCount: schedule.currentlyStreaming.length,
    eventCount: allEvents.length,
    shows: schedule.currentlyStreaming.map(s => ({
      title: s.title,
      day: s.day,
      currentEp: s.currentEp,
      totalEp: s.totalEp,
      suspended: s.suspended,
      resumeDate: s.resumeDate,
    })),
  }, null, 2), 'utf8');

  console.log(`[anime-dub-cal] ✓ Written: ${ICS_PATH} (Default: Title - Ep ##)`);
  console.log(`[anime-dub-cal] ✓ Written: ${ICS_EP_FIRST_PATH} (Compact: Ep ## · Title)`);
  console.log(`[anime-dub-cal] ✓ Written: ${SCHEDULE_PATH}`);
  console.log(`[anime-dub-cal] ✓ Written: ${STATE_PATH}`);
}

main().catch(err => {
  console.error('[anime-dub-cal] Fatal error:', err);
  process.exit(1);
});
