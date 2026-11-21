/**
 * generate-ics.js
 *
 * Produces a valid RFC 5545 .ics calendar string from a list of episode events.
 * - UTC timestamps for published releases, time zone-independent dates otherwise
 * - Deterministic UIDs: mal-dub-<slug>-ep-<n>@anime-dub-cal
 * - DTSTAMP set to current build time (required by RFC 5545)
 */

import { makeSlug } from './cour-logic.js';
import { DUB_CALENDAR_URL } from './dub-calendar.js';

const CALENDAR_NAME = 'Anime Dubs Schedule';
const CALENDAR_DESC = 'Anime dub schedules from MyAnimeList and English Dubbed';
const UID_DOMAIN = 'anime-dub-cal';

/**
 * @param {import('./cour-logic.js').EpisodeEvent[]} events
 * @param {string} lastUpdated  - Human-readable last-updated string for calendar description
 * @param {Object} [options]
 * @param {'title-first'|'ep-first'} [options.titleFormat='title-first'] - 'title-first' = Title - Ep ##, 'ep-first' = Ep ## · Title
 * @param {string} [options.calendarName]
 * @returns {string} ICS file contents
 */
export function generateIcs(events, lastUpdated, options = {}) {
  const { titleFormat = 'title-first', calendarName = CALENDAR_NAME } = options;
  const now = formatIcsDatetime(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//anime-dub-cal//EN',
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
    `X-WR-CALDESC:${escapeIcs(`${CALENDAR_DESC} (MAL updated: ${lastUpdated})`)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const event of events) {
    lines.push(...buildVevent(event, now, titleFormat));
  }

  lines.push('END:VCALENDAR');

  // RFC 5545: lines must be folded at 75 octets
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// VEVENT builder
// ---------------------------------------------------------------------------

function buildVevent(event, dtstamp, titleFormat = 'title-first') {
  const slug = makeSlug(event.title);
  const uid = `mal-dub-${slug}-ep-${event.episodeNumber}@${UID_DOMAIN}`;

  let summary = titleFormat === 'ep-first'
    ? `Ep ${event.episodeNumber} · ${event.title}`
    : `${event.title} - Ep ${event.episodeNumber}`;
  if (event.isResumeEvent) {
    summary += ' (Resumes)';
  } else if (event.isPremierePlaceholder) {
    summary += ' (Premiere)';
    if (!event.dateConfirmed) summary += '*';
  } else if (event.isProjected) {
    summary += ' (Projected)';
  }
  if (event.isMultiDrop) summary += ' 📦 Multi-drop';

  const descParts = [];
  if (event.malUrl) descParts.push(`MAL: ${event.malUrl}`);
  if (event.releaseAt) descParts.push(`Release time: ${DUB_CALENDAR_URL}`);
  if (event.isResumeEvent) {
    descParts.push('Show returns from broadcast hiatus on this date.');
  } else if (event.isProjected && !event.isPremierePlaceholder) {
    descParts.push('Note: Episode date projected based on cour heuristics.');
  }
  if (event.isPremierePlaceholder && !event.releaseAt) {
    descParts.push('Premiere placeholder — full schedule will appear when the show begins airing.');
    if (!event.dateConfirmed) descParts.push('* Date not yet officially confirmed.');
  }
  if (event.isMultiDrop) {
    descParts.push('Multiple episodes dropped on this date.');
  }

  const description = descParts.join('\n');
  const eventUrl = event.malUrl || (event.releaseAt ? DUB_CALENDAR_URL : null);

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    ...(event.releaseAt ? [`DTSTART:${formatIcsDatetime(event.releaseAt)}`] : [
      `DTSTART;VALUE=DATE:${formatIcsDate(event.date)}`,
      `DTEND;VALUE=DATE:${formatIcsDate(addDays(event.date, 1))}`,
    ]),
    'TRANSP:TRANSPARENT',
    `SUMMARY:${escapeIcs(summary)}`,
    ...(description ? [`DESCRIPTION:${escapeIcs(description)}`] : []),
    ...(eventUrl ? [`URL:${eventUrl}`] : []),
    'END:VEVENT',
  ];
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatIcsDate(date) {
  // YYYYMMDD for all-day events (no timezone conversion needed for DATE values)
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function formatIcsDatetime(date) {
  // YYYYMMDDTHHmmssZ (UTC)
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

// ---------------------------------------------------------------------------
// ICS string helpers
// ---------------------------------------------------------------------------

function escapeIcs(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 line folding: lines > 75 octets must be folded.
 */
function foldLine(line) {
  const MAX = 75;
  if (Buffer.byteLength(line, 'utf8') <= MAX) return line;
  const chunks = [];
  let current = '';
  for (const char of line) {
    const testLine = current + char;
    if (Buffer.byteLength(testLine, 'utf8') > MAX) {
      chunks.push(current);
      current = ' ' + char;
    } else {
      current = testLine;
    }
  }
  if (current) chunks.push(current);
  return chunks.join('\r\n');
}
