/**
 * cour-logic.js
 *
 * Given a parsed show entry and previously-saved state, compute the list of
 * future episode events to emit in the calendar.
 *
 * Cour standards:
 *   1-cour  = 12 eps  (sometimes 13)
 *   2-cour  = 24 eps  (sometimes 25-26)
 *   Long-running = rolling +4 episodes ahead
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
 * @property {Date}   date           - The projected air date (all-day)
 * @property {boolean} isProjected   - true = cour estimate, false = derived from known total
 * @property {boolean} isMultiDrop   - true = multiple eps dropped same day
 */

/**
 * Main entry point: compute all episode events for a show.
 *
 * @param {import('./parse.js').ShowEntry} show
 * @param {Object} prevState        - { [showSlug]: { lastEp: number, lastSeen: ISO string } }
 * @param {Date}   referenceDate    - "today" for computing future dates
 * @param {Date}   lastUpdatedDate  - The forum's "Last Updated" date
 * @returns {EpisodeEvent[]}
 */
export function computeEpisodeEvents(show, prevState, referenceDate, lastUpdatedDate) {
  const { title, malUrl, currentEp, totalEp, suspended, resumeDate, day } = show;

  // Suspended shows (**): dub production is suspended indefinitely — no events
  if (suspended) return [];

  // Hiatus / Resuming shows (++):
  // The show is currently on hiatus and not airing weekly.
  // Emit at most a single reminder event on the exact return date.
  if (resumeDate) {
    const resumeParsed = new Date(resumeDate + ' 12:00:00');
    if (!isNaN(resumeParsed) && resumeParsed > referenceDate) {
      return [{
        title,
        malUrl,
        episodeNumber: currentEp + 1,
        date: resumeParsed,
        isProjected: true,
        isMultiDrop: false,
        isResumeEvent: true,
      }];
    }
  }

  const slug = makeSlug(title);
  const prev = prevState[slug] || null;

  // ------------------------------------------------------------------
  // Detect multi-episode drops vs stale post
  // ------------------------------------------------------------------
  const daysSinceUpdate = (referenceDate - lastUpdatedDate) / (1000 * 60 * 60 * 24);
  const postIsFresh = daysSinceUpdate <= 7;

  let extraDroppedEps = [];
  if (prev && currentEp > prev.lastEp + 1 && postIsFresh) {
    // Counter jumped by more than 1 in a fresh post — multiple eps dropped on same day
    for (let ep = prev.lastEp + 1; ep < currentEp; ep++) {
      extraDroppedEps.push(ep);
    }
  }

  // ------------------------------------------------------------------
  // Determine the projected total episodes
  // ------------------------------------------------------------------
  const projectedTotal = computeProjectedTotal(currentEp, totalEp);
  const isProjected = totalEp === null;

  // ------------------------------------------------------------------
  // Build future episode dates
  // ------------------------------------------------------------------
  const events = [];

  // Multi-drop: emit all dropped episodes as events on the CURRENT day's date
  // (anchored to the most recent occurrence of `day` on or before referenceDate)
  if (extraDroppedEps.length > 0) {
    const dropDate = mostRecentWeekday(day, referenceDate);
    for (const ep of extraDroppedEps) {
      events.push({
        title,
        malUrl,
        episodeNumber: ep,
        date: new Date(dropDate),
        isProjected: false,
        isMultiDrop: true,
      });
    }
  }

  // Future episodes: from currentEp+1 up to projectedTotal
  let weekOffset = 0;
  for (let ep = currentEp + 1; ep <= projectedTotal; ep++) {
    weekOffset++;
    const epDate = nextWeekday(day, referenceDate, weekOffset);
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
    // Standard 1-cour: project to 12
    return 12;
  } else if (currentEp === 12 || currentEp === 13) {
    // At 1-cour boundary: +2 buffer
    return currentEp + 2;
  } else if (currentEp > 13 && currentEp < 24) {
    // Standard 2-cour: project to 24
    return 24;
  } else if (currentEp === 24 || currentEp === 25) {
    // At 2-cour boundary: +2 buffer
    return currentEp + 2;
  } else {
    // Long-runner or multi-cour: rolling +4 episodes
    return currentEp + 4;
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

  const date = new Date(upcoming.premiereDate + 'T12:00:00'); // noon UTC avoids timezone flip
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

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Return the Date of the Nth occurrence of `weekdayName` after `anchor`.
 * weekOffset=1 means the first occurrence of that weekday strictly after anchor.
 */
function nextWeekday(weekdayName, anchor, weekOffset) {
  const targetDay = WEEKDAY_INDEX[weekdayName];
  const anchorDay = anchor.getDay();
  let daysUntil = (targetDay - anchorDay + 7) % 7;
  if (daysUntil === 0) daysUntil = 7; // start from next week if same day as anchor
  const firstNext = new Date(anchor);
  firstNext.setDate(anchor.getDate() + daysUntil);
  // Then add (weekOffset - 1) more weeks
  firstNext.setDate(firstNext.getDate() + (weekOffset - 1) * 7);
  return firstNext;
}

/**
 * Return the most recent occurrence of `weekdayName` on or before `anchor`.
 * Used to anchor multi-drop events.
 */
function mostRecentWeekday(weekdayName, anchor) {
  const targetDay = WEEKDAY_INDEX[weekdayName];
  const anchorDay = anchor.getDay();
  let daysBack = (anchorDay - targetDay + 7) % 7;
  const result = new Date(anchor);
  result.setDate(anchor.getDate() - daysBack);
  return result;
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
