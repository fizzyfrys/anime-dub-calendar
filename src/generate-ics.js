/**
 * generate-ics.js
 *
 * Produces a valid RFC 5545 .ics calendar string from a list of episode events.
 * - All-day events in America/Los_Angeles timezone
 * - Deterministic UIDs: mal-dub-<slug>-ep-<n>@anime-dub-cal
 * - DTSTAMP set to current build time (required by RFC 5545)
 */

import { makeSlug } from './cour-logic.js';

const TIMEZONE = 'America/Los_Angeles';
const CALENDAR_NAME = 'Anime Dubs Schedule';
const CALENDAR_DESC = 'Auto-updated weekly anime dub release calendar from MyAnimeList';
const UID_DOMAIN = 'anime-dub-cal';

/**
 * @param {import('./cour-logic.js').EpisodeEvent[]} events
 * @param {string} lastUpdated  - Human-readable last-updated string for calendar description
 * @returns {string} ICS file contents
 */
export function generateIcs(events, lastUpdated) {
  const now = formatIcsDatetime(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//anime-dub-cal//EN',
    `X-WR-CALNAME:${CALENDAR_NAME}`,
    `X-WR-TIMEZONE:${TIMEZONE}`,
    `X-WR-CALDESC:${CALENDAR_DESC} (Source updated: ${lastUpdated})`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // Embed minimal VTIMEZONE for America/Los_Angeles so clients don't need network lookup
    ...VTIMEZONE_LA,
  ];

  for (const event of events) {
    lines.push(...buildVevent(event, now));
  }

  lines.push('END:VCALENDAR');

  // RFC 5545: lines must be folded at 75 octets
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// VEVENT builder
// ---------------------------------------------------------------------------

function buildVevent(event, dtstamp) {
  const slug = makeSlug(event.title);
  const uid = `mal-dub-${slug}-ep-${event.episodeNumber}@${UID_DOMAIN}`;

  // DTSTART for all-day: YYYYMMDD
  const dtstart = formatIcsDate(event.date);
  // DTEND = day after for all-day events
  const dtend = formatIcsDate(addDays(event.date, 1));

  let summary = `${event.title} - Ep ${event.episodeNumber}`;
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
  if (event.isResumeEvent) {
    descParts.push('Show returns from broadcast hiatus on this date.');
  } else if (event.isProjected && !event.isPremierePlaceholder) {
    descParts.push('Note: Episode date projected based on cour heuristics.');
  }
  if (event.isPremierePlaceholder) {
    descParts.push('Premiere placeholder — full schedule will appear when the show begins airing.');
    if (!event.dateConfirmed) descParts.push('* Date not yet officially confirmed.');
  }
  if (event.isMultiDrop) {
    descParts.push('Multiple episodes dropped on this date.');
  }

  const description = descParts.join('\\n');

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `DTEND;VALUE=DATE:${dtend}`,
    `SUMMARY:${escapeIcs(summary)}`,
    ...(description ? [`DESCRIPTION:${escapeIcs(description)}`] : []),
    `URL:${event.malUrl || ''}`,
    'END:VEVENT',
  ];
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatIcsDate(date) {
  // YYYYMMDD for all-day events (no timezone conversion needed for DATE values)
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatIcsDatetime(date) {
  // YYYYMMDDTHHmmssZ (UTC)
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
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
    .replace(/\n/g, '\\n');
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

// ---------------------------------------------------------------------------
// Minimal VTIMEZONE for America/Los_Angeles (covers PST/PDT)
// ---------------------------------------------------------------------------
const VTIMEZONE_LA = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Los_Angeles',
  'X-LIC-LOCATION:America/Los_Angeles',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];
