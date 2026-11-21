import { parse as parseHTML } from 'node-html-parser';

const MAL_URL = 'https://myanimelist.net/forum/?topicid=1692966';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Fetch and parse the MAL forum thread.
 * @param {string|null} localPath - If provided, read from this local file instead of fetching.
 * @returns {Promise<ParsedSchedule>}
 */
export async function fetchAndParse(localPath = null) {
  let html;

  if (localPath) {
    const { readFile } = await import('fs/promises');
    html = await readFile(localPath, 'utf8');
  } else {
    const res = await fetch(MAL_URL, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; anime-dub-cal/1.0; +https://github.com)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`MAL fetch failed: ${res.status} ${res.statusText}`);
    html = await res.text();
  }

  return parseForumHtml(html);
}

/**
 * @typedef {Object} ShowEntry
 * @property {string} title
 * @property {string} malUrl
 * @property {number} currentEp
 * @property {number|null} totalEp  - null = unknown (?/??/???/????)
 * @property {boolean} suspended    - true if marked **
 * @property {string|null} resumeDate - parsed from ++ annotation text
 * @property {string} day
 */

/**
 * @typedef {Object} UpcomingEntry
 * @property {string} title
 * @property {string|null} premiereDate  - ISO date string YYYY-MM-DD, or null if undated
 * @property {string|null} malUrl
 * @property {boolean} dateConfirmed    - false if marked with *
 */

/**
 * @typedef {Object} ParsedSchedule
 * @property {string} lastUpdated       - Raw "Last Updated" string from the post
 * @property {Date}   lastUpdatedDate   - Parsed Date object
 * @property {ShowEntry[]} currentlyStreaming
 * @property {UpcomingEntry[]} upcomingSimulDubbed
 */

/**
 * Parse a raw HTML string from the MAL forum page.
 * @param {string} html
 * @returns {ParsedSchedule}
 */
export function parseForumHtml(html) {
  const root = parseHTML(html);

  // Find the first forum post — the main pinned schedule post
  const firstPost = root.querySelector('#msg53221626') ||
    root.querySelector('.forum-topic-message');

  if (!firstPost) throw new Error('Could not locate the main forum post in the HTML.');

  // ------------------------------------------------------------------
  // 1. Extract "Last Updated" date
  // ------------------------------------------------------------------
  const bodyText = firstPost.text;
  const lastUpdatedMatch = bodyText.match(/Last Updated:\s*([A-Za-z]+ \d+,\s*\d{4})/);
  const lastUpdatedRaw = lastUpdatedMatch ? lastUpdatedMatch[1].trim() : 'Unknown';
  const lastUpdatedDate = lastUpdatedRaw !== 'Unknown' ? parseCivilDate(lastUpdatedRaw) : new Date(0);

  // ------------------------------------------------------------------
  // 2. Parse "Currently Streaming SimulDubbed Anime" section
  // ------------------------------------------------------------------
  // Find the <b> element whose text matches the section header
  const allBold = firstPost.querySelectorAll('b');
  let streamingUl = null;
  for (const b of allBold) {
    if (b.text.includes('Currently Streaming SimulDubbed Anime')) {
      streamingUl = findSectionList(b, firstPost);
      break;
    }
  }

  const currentlyStreaming = [];
  const globalAnnotations = { resumeDate: null };

  if (streamingUl) {
    // Top-level <li> elements are the weekday names
    const dayItems = streamingUl.querySelectorAll(':scope > li');

    // First pass: extract global annotation lines (** = ... , ++ = ...)
    const outerText = streamingUl.text;
    parseGlobalAnnotations(outerText, globalAnnotations);

    for (const dayItem of dayItems) {
      // Day name is the first text node in the <li>
      const dayText = dayItem.childNodes[0]?.text?.trim() || '';
      const day = DAYS.find(d => dayText.startsWith(d));
      if (!day) continue;

      // Nested <ul> contains the shows for this day
      const showUl = dayItem.querySelector('ul');
      if (!showUl) continue;

      const showItems = showUl.querySelectorAll(':scope > li');
      for (const showItem of showItems) {
        const entry = parseShowItem(showItem, day, globalAnnotations);
        if (entry) currentlyStreaming.push(entry);
      }
    }
  }

  // ------------------------------------------------------------------
  // 3. Parse "Upcoming SimulDubbed Anime" sections
  // ------------------------------------------------------------------
  const upcomingSimulDubbed = [];

  for (const b of allBold) {
    const txt = b.text;
    if (!txt.includes('Upcoming SimulDubbed Anime')) continue;

    const ul = findSectionList(b, firstPost);
    if (!ul) continue;

    const items = ul.querySelectorAll(':scope > li');
    for (const item of items) {
      const entry = parseUpcomingItem(item);
      if (entry) upcomingSimulDubbed.push(entry);
    }
  }

  if (!currentlyStreaming.some(show => show.currentEp > 0)) {
    throw new Error('Could not locate active episode counts in the MAL schedule.');
  }

  return {
    lastUpdated: lastUpdatedRaw,
    lastUpdatedDate,
    currentlyStreaming,
    upcomingSimulDubbed,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findSectionList(heading, post) {
  for (let node = heading; node && node !== post; node = node.parentNode) {
    const siblings = node.parentNode.childNodes;
    for (const sibling of siblings.slice(siblings.indexOf(node) + 1)) {
      if (sibling.tagName === 'UL') return sibling;
      if (sibling.text.trim()) return null; // Don't borrow a list from the next section.
    }
  }
  return null;
}

export function parseCivilDate(text) {
  return new Date(`${text} 12:00:00 GMT`);
}

function isExcludedPlatform(note) {
  return /\bOcean\s*Veil\b|\bYouTube\s*[- ]\s*only\b|\bonly on YouTube\b|\(\s*YouTube\s*\)/i.test(note);
}

function parseGlobalAnnotations(text, annotations) {
  const resumeMatch = text.match(/\+\+\s*=\s*(?:Resumes|Dub production suspended until)\s+([A-Za-z]+ \d+,?\s*\d{4})/i);
  if (resumeMatch) {
    annotations.resumeDate = resumeMatch[1].trim();
  }
}

/**
 * Parse a single show <li> item into a ShowEntry.
 */
function parseShowItem(showItem, day, globalAnnotations) {
  const anchor = showItem.querySelector('a');
  if (!anchor) return null;

  const title = anchor.text.trim();
  const malUrl = anchor.getAttribute('href') || '';

  // The raw text of this <li> after the anchor
  const rawText = showItem.text;

  // Episode count: (Episodes: X/Y) or (Episodes: X/??) etc.
  const epMatch = rawText.match(/\(Episodes?:\s*(\d+)\s*\/\s*(\d+|\?{1,4})\)/i);
  let currentEp = 0;
  let totalEp = null;
  if (epMatch) {
    currentEp = parseInt(epMatch[1], 10);
    const totalRaw = epMatch[2];
    if (/^\d+$/.test(totalRaw)) {
      totalEp = parseInt(totalRaw, 10);
    }
    // else totalEp stays null (unknown)
  }

  // Resume date: trailing ++ after the entry (uses global resume date)
  const hasResume = rawText.includes('++');
  const resumeDate = hasResume ? globalAnnotations.resumeDate : null;
  const suspended = rawText.includes('**') || rawText.includes('* *') || (hasResume && !resumeDate);

  if (!title) return null;

  return {
    title, malUrl, currentEp, totalEp, suspended, resumeDate, day,
    platformExcluded: isExcludedPlatform(rawText.slice(rawText.indexOf(title) + title.length)),
  };
}

/**
 * Parse an upcoming show <li> item.
 * Expected formats:
 *   Show Title - October 13, 2026
 *   Show Title - October 13, 2026*
 *   Show Title (no date)
 */
function parseUpcomingItem(item) {
  const anchor = item.querySelector('a');
  const rawText = item.text.replace(/\s*\*\s*-\s*Not confirmed\.?\s*$/i, '').trim();

  // Strip trailing footnote markers and whitespace
  const cleanText = rawText.replace(/\*$/, '').trim();
  const dateConfirmed = !rawText.trim().endsWith('*');

  const title = anchor ? anchor.text.trim() : cleanText.split(' - ')[0].trim();
  const malUrl = anchor ? (anchor.getAttribute('href') || null) : null;

  // Date: "- Month DD, YYYY" at end of line
  const dateMatch = cleanText.match(/-\s*([A-Za-z]+ \d+,?\s*\d{4})\s*$/);
  let premiereDate = null;
  if (dateMatch) {
    const parsed = parseCivilDate(dateMatch[1].trim());
    if (!isNaN(parsed)) {
      // Format as YYYY-MM-DD
      premiereDate = parsed.toISOString().split('T')[0];
    }
  }

  // Skip entries with no date and no useful title
  if (!title) return null;

  return {
    title, premiereDate, malUrl, dateConfirmed,
    platformExcluded: isExcludedPlatform(rawText.slice(rawText.indexOf(title) + title.length)),
  };
}
