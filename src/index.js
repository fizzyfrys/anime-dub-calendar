/**
 * index.js — Pipeline orchestrator
 *
 * Usage:
 *   node src/index.js                          # fetch live from MAL
 *   node src/index.js --local <path-to-html>   # parse local HTML file
 */

import { fetchAndParse } from './parse.js';
import { computeEpisodeEvents, computeUpcomingEvents, makeSlug } from './cour-logic.js';
import { generateIcs } from './generate-ics.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const ICS_PATH = path.join(DOCS_DIR, 'anime-dubs.ics');
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

  // 2. Load previous state (for multi-episode drop detection)
  let prevState = {};
  if (existsSync(STATE_PATH)) {
    try {
      prevState = JSON.parse(await readFile(STATE_PATH, 'utf8'));
    } catch {
      console.warn('[anime-dub-cal] Could not parse state.json, starting fresh.');
    }
  }

  // 3. Compute episode events
  const referenceDate = new Date();
  const allEvents = [];

  // 3a. Currently streaming shows
  for (const show of schedule.currentlyStreaming) {
    const events = computeEpisodeEvents(show, prevState, referenceDate, schedule.lastUpdatedDate);
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

  // 4. Generate ICS
  const icsContent = generateIcs(allEvents, schedule.lastUpdated);

  // 5. Save new state (record current episode counts per show)
  const newState = {};
  for (const show of schedule.currentlyStreaming) {
    const slug = makeSlug(show.title);
    newState[slug] = {
      lastEp: show.currentEp,
      lastSeen: new Date().toISOString(),
      title: show.title,
    };
  }

  // 6. Write output files
  await mkdir(DOCS_DIR, { recursive: true });
  await writeFile(ICS_PATH, icsContent, 'utf8');
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

  console.log(`[anime-dub-cal] ✓ Written: ${ICS_PATH}`);
  console.log(`[anime-dub-cal] ✓ Written: ${SCHEDULE_PATH}`);
  console.log(`[anime-dub-cal] ✓ Written: ${STATE_PATH}`);
}

main().catch(err => {
  console.error('[anime-dub-cal] Fatal error:', err);
  process.exit(1);
});
