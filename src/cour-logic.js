/**
 * cour-logic.js
 *
 * Given a parsed show entry and previously-saved state, compute the list of
 * past, current, and future episode events to emit in the calendar.
 *
 * Design:
 *   - currentEp is anchored to this week's broadcast weekday (e.g. today for Friday shows).
 *   - Past episodes (ep 1 to currentEp) are preserved on historical broadcast dates so calendar
 *     events are NEVER deleted after they air and the calendar grows continuously.
 *   - Future episodes are projected forward using anime cour heuristics (1-cour 12, 2-cour 24).
 */

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
 * @returns {EpisodeEvent[]}
 */
export function computeEpisodeEvents(show, prevState, referenceDate, lastUpdatedDate) {
  const { title, malUrl, currentEp, totalEp, suspended, resumeDate, day } = show;

  if (!currentEp || currentEp < 1) return [];

  // Calculate the exact date for currentEp in the current broadcast week
  const currentEpDate = getBroadcastWeekDate(day, lastUpdatedDate, referenceDate);
  const events = [];

  // ------------------------------------------------------------------
  // 1. Past (Previous Week) & Current Week Episodes
  // ------------------------------------------------------------------
  // Include previous week (currentEp - 1) and current week (currentEp)
  // Real history accumulates in state.json over time without guessing distant past weeks
  const startEp = Math.max(1, currentEp - 1);

  for (let ep = startEp; ep <= currentEp; ep++) {
    const epDate = new Date(currentEpDate);
    epDate.setDate(currentEpDate.getDate() - (currentEp - ep) * 7);

    events.push({
      title,
      malUrl,
      episodeNumber: ep,
      date: epDate,
      isProjected: false,
      isMultiDrop: false,
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
    const resumeParsed = new Date(resumeDate + ' 12:00:00');
    if (!isNaN(resumeParsed) && resumeParsed > referenceDate) {
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
  // 3. Multi-Episode Drop Detection
  // ------------------------------------------------------------------
  const slug = makeSlug(title);
  const prev = prevState[slug] || null;
  const daysSinceUpdate = (referenceDate - lastUpdatedDate) / (1000 * 60 * 60 * 24);
  const postIsFresh = daysSinceUpdate <= 7;

  if (prev && currentEp > prev.lastEp + 1 && postIsFresh) {
    // The counter jumped by >1 in a fresh post — multiple eps dropped on the same currentEpDate
    for (let ep = prev.lastEp + 1; ep < currentEp; ep++) {
      const existing = events.find(e => e.episodeNumber === ep);
      if (existing) {
        existing.date = new Date(currentEpDate);
        existing.isMultiDrop = true;
      }
    }
  }

  // ------------------------------------------------------------------
  // 4. Future Episode Projections (ep = currentEp + 1 ... projectedTotal)
  // ------------------------------------------------------------------
  const projectedTotal = computeProjectedTotal(currentEp, totalEp);
  const isProjected = totalEp === null;

  for (let ep = currentEp + 1; ep <= projectedTotal; ep++) {
    const epDate = new Date(currentEpDate);
    epDate.setDate(currentEpDate.getDate() + (ep - currentEp) * 7);

    events.push({
      title,
      malUrl,
      episodeNumber: ep,
      date: epDate,
      isProjected,
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
  const baseDay = baseDate.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const mondayOffset = baseDay === 0 ? -6 : 1 - baseDay;
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() + mondayOffset);

  // Target day offset from Monday: Mon = 0, Tue = 1, ... Sun = 6
  const targetOffset = targetDay === 0 ? 6 : targetDay - 1;
  const result = new Date(monday);
  result.setDate(monday.getDate() + targetOffset);
  result.setHours(12, 0, 0, 0); // Noon UTC to avoid DST hour shift issues
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

  const date = new Date(upcoming.premiereDate + 'T12:00:00');
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
