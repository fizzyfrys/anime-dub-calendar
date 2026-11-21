/**
 * cour-logic.js
 *
 * Given a parsed show entry and previously-saved state, compute the list of
 * past, current, and future episode events to emit in the calendar.
 *
 * Design:
 *   - currentEp is anchored to this week's broadcast weekday (e.g. today for Friday shows).
 *   - Keep recorded episode dates while a show is tracked by MAL.
 *   - Future episodes are projected forward using anime cour heuristics (1-cour 12, 2-cour 24).
 */

import { parseCivilDate } from './parse.js';

const WEEKDAY_INDEX = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 0,
};

/**
 * @typedef {Object} EpisodeEvent
 * @property {string} title
 * @property {string} malUrl
 * @property {number} episodeNumber
 * @property {Date}   date           - The air date (all-day)
 * @property {Date}   [releaseAt]    - Published release instant, when available
 * @property {boolean} isProjected   - true = cour estimate, false = confirmed/aired
 * @property {boolean} isMultiDrop   - true = multiple eps dropped same day
 * @property {boolean} [isResumeEvent]
 * @property {boolean} [isPremierePlaceholder]
 * @property {boolean} [dateConfirmed]
 */

/**
 * Main entry point: compute all episode events (past, current, and future) for a show.
 *
 * @param {import('./parse.js').ShowEntry} show
 * @param {Object} prevState        - { [showSlug]: { lastEp: number, lastSeen: ISO string } }
 * @param {Date}   referenceDate    - "today" for computing dates
 * @param {Date}   lastUpdatedDate  - The forum's "Last Updated" date
 * @param {Object} showHistory      - Episode numbers mapped to saved ISO dates
 * @param {Map<number, Date>} verifiedDates - Dates for releases listed by English Dubbed
 * @returns {EpisodeEvent[]}
 */
export function computeEpisodeEvents(show, prevState, referenceDate, lastUpdatedDate,
  showHistory = {}, verifiedDates = new Map()) {
  const { title, malUrl, currentEp, totalEp, suspended, resumeDate, day } = show;

  if (!currentEp || currentEp < 1) return [];

  // Prefer the published or saved date to an estimate from the forum week.
  const estimatedDate = getBroadcastWeekDate(day, lastUpdatedDate, referenceDate);
  const savedDate = ep => showHistory[ep] ? new Date(showHistory[ep] + 'T12:00:00Z') : null;
  const currentEpDate = verifiedDates.get(currentEp) ?? savedDate(currentEp) ?? estimatedDate;
  const events = [];

  // ------------------------------------------------------------------
  // 1. Past (Previous Week) & Current Week Episodes
  // ------------------------------------------------------------------
  // Include previous week (currentEp - 1) and current week (currentEp)
  // Real history accumulates in state.json over time without guessing distant past weeks
  const prev = prevState[makeSlug(title)];
  const daysSinceUpdate = (referenceDate - lastUpdatedDate) / 86_400_000;
  const prevEpDate = savedDate(prev?.lastEp);
  const daysSincePreviousEpisode = prevEpDate ? (currentEpDate - prevEpDate) / 86_400_000 : null;
  const isMultiDrop = Boolean(prev && currentEp > prev.lastEp + 1 && daysSinceUpdate <= 7 &&
    daysSinceUpdate >= -1 && (daysSincePreviousEpisode === null ||
      (daysSincePreviousEpisode >= 0 && daysSincePreviousEpisode <= 7)));
  const startEp = isMultiDrop ? prev.lastEp + 1 : Math.max(1, currentEp - 1);

  for (let ep = startEp; ep <= currentEp; ep++) {
    const epDate = verifiedDates.get(ep) ?? savedDate(ep) ?? addDays(currentEpDate, isMultiDrop ? 0 : (ep - currentEp) * 7);

    events.push({
      title,
      malUrl,
      episodeNumber: ep,
      date: epDate,
      isProjected: false,
      isMultiDrop,
    });
  }

  // ------------------------------------------------------------------
  // 2. Suspended & Hiatus Shows Handling
  // ------------------------------------------------------------------
  if (suspended) {
    // Show is on indefinite suspension — past history is preserved, but no future projections
    return events;
  }

  if (resumeDate) {
    // Show is on hiatus until a specific date — emit past history + 1 single resume event
    const resumeParsed = parseCivilDate(resumeDate);
    if (!isNaN(resumeParsed) && resumeParsed.toISOString().slice(0, 10) >= referenceDate.toISOString().slice(0, 10)) {
      events.push({
        title,
        malUrl,
        episodeNumber: currentEp + 1,
        date: resumeParsed,
        isProjected: true,
        isMultiDrop: false,
        isResumeEvent: true,
      });
    }
    return events;
  }

  // ------------------------------------------------------------------
  // 3. Future Episode Projections
  // ------------------------------------------------------------------
  let anchorEp = currentEp;
  let anchorDate = currentEpDate;
  for (const [ep, date] of verifiedDates) {
    if (ep > anchorEp && (totalEp === null || ep <= totalEp)) {
      anchorEp = ep;
      anchorDate = date;
    }
  }
  // Find MAL's normal weekday closest to a week after the timed release.
  const daysToNextRelease = 4 + (WEEKDAY_INDEX[day] - anchorDate.getUTCDay() + 10) % 7;
  const projectedTotal = computeProjectedTotal(anchorEp, totalEp);
  for (let ep = anchorEp + 1; ep <= projectedTotal; ep++) {
    const epDate = addDays(anchorDate, daysToNextRelease + (ep - anchorEp - 1) * 7);

    events.push({
      title,
      malUrl,
      episodeNumber: ep,
      date: epDate,
      isProjected: true,
      isMultiDrop: false,
    });
  }

  return events;
}

/**
 * Calculate the calendar date for a given weekday in the current broadcast week.
 *
 * @param {string} dayName
 * @param {Date} lastUpdatedDate
 * @param {Date} referenceDate
 * @returns {Date}
 */
export function getBroadcastWeekDate(dayName, lastUpdatedDate, referenceDate) {
  const targetDay = WEEKDAY_INDEX[dayName];
  const baseDate = (lastUpdatedDate && !isNaN(lastUpdatedDate.getTime()) && lastUpdatedDate.getTime() > 0)
    ? lastUpdatedDate
    : referenceDate;

  // Find Monday of the broadcast week
  const baseDay = baseDate.getUTCDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const mondayOffset = baseDay === 0 ? -6 : 1 - baseDay;
  const monday = new Date(baseDate);
  monday.setUTCDate(baseDate.getUTCDate() + mondayOffset);

  // Target day offset from Monday: Mon = 0, Tue = 1, ... Sun = 6
  const targetOffset = targetDay === 0 ? 6 : targetDay - 1;
  const result = addDays(monday, targetOffset);
  result.setUTCHours(12, 0, 0, 0);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Compute the projected total episode count for a show.
 *
 * @param {number}      currentEp
 * @param {number|null} totalEp   - null = unknown
 * @returns {number}
 */
export function computeProjectedTotal(currentEp, totalEp) {
  // Known total: use it exactly
  if (totalEp !== null) return totalEp;

  // Unknown total: apply cour heuristics
  if (currentEp < 12) {
    return 12; // Standard 1-cour
  } else if (currentEp === 12 || currentEp === 13) {
    return currentEp + 2; // At 1-cour boundary: +2 buffer
  } else if (currentEp > 13 && currentEp < 24) {
    return 24; // Standard 2-cour
  } else if (currentEp === 24 || currentEp === 25) {
    return currentEp + 2; // At 2-cour boundary: +2 buffer
  } else {
    return currentEp + 4; // Long-runner / multi-cour: rolling +4 episodes
  }
}

/**
 * Compute episode events for an upcoming premiere (not yet "Currently Streaming").
 * Emits a single Ep 1 placeholder on the premiere date.
 *
 * @param {import('./parse.js').UpcomingEntry} upcoming
 * @returns {EpisodeEvent[]}
 */
export function computeUpcomingEvents(upcoming) {
  if (!upcoming.premiereDate) return [];

  const date = new Date(upcoming.premiereDate + 'T12:00:00Z');
  return [{
    title: upcoming.title,
    malUrl: upcoming.malUrl || '',
    episodeNumber: 1,
    date,
    isProjected: true,
    isMultiDrop: false,
    isPremierePlaceholder: true,
    dateConfirmed: upcoming.dateConfirmed,
  }];
}

/**
 * Create a URL-safe slug from a show title.
 */
export function makeSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
