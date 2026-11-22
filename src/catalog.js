import { createHash } from 'node:crypto';
import { titleKey } from './dub-calendar.js';

function malId(url) {
  return Number(url?.match(/^https:\/\/myanimelist\.net\/anime\/(\d+)(?:\/|$)/)?.[1]) || null;
}

export function buildCatalog(events, active, releases, previous = [], excluded = new Set(), now = new Date()) {
  const shows = new Map();
  const byTitle = new Map();
  const platforms = new Map();
  for (const release of releases) {
    const key = titleKey(release.title);
    if (!platforms.has(key)) platforms.set(key, new Map());
    platforms.get(key).set(release.episodeNumber, release.platforms);
  }

  function showFor({ title, malUrl }) {
    const key = titleKey(title);
    const mal = malId(malUrl);
    const id = mal ? `mal-${mal}` : byTitle.get(key)
      ?? `title-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
    if (!shows.has(id)) shows.set(id, {
      id, malId: mal, title, platforms: [], airing: false, episodes: [],
    });
    if (mal || !byTitle.has(key)) byTitle.set(key, id);
    return shows.get(id);
  }

  for (const row of active) {
    const show = showFor(row);
    show.airing = !row.suspended && !row.resumeDate;
    show.currentEp = row.currentEp;
    show.totalEp = row.totalEp;
  }
  // Establish MAL identifiers before grouping any supplemental-only events by title.
  for (const event of events) if (malId(event.malUrl)) showFor(event);
  for (const event of events) {
    const show = showFor(event);
    const sources = platforms.get(titleKey(event.title));
    if (sources) show.platforms = [...new Set([...sources.values()].flat())].sort();
    const { date, releaseAt, title, malUrl, ...episode } = event;
    show.episodes.push({
      ...episode,
      ...(title === show.title ? {} : { title }),
      date: date.toISOString().slice(0, 10),
      ...(releaseAt ? { startsAt: releaseAt.toISOString() } : {}),
      platforms: sources?.get(episode.episodeNumber) ?? [],
    });
  }
  for (const old of previous) {
    if (excluded.has(titleKey(old.title))) continue;
    const show = shows.get(old.id) ?? (old.malId ? undefined : shows.get(byTitle.get(titleKey(old.title)))) ??
      { ...old, airing: false, episodes: [] };
    const aliases = [...new Set([...(show.aliases ?? []), ...(old.aliases ?? []), old.id])]
      .filter(id => id !== show.id);
    if (aliases.length) show.aliases = aliases;
    const episodes = new Map(show.episodes.map(episode => [episode.episodeNumber, episode]));
    const cutoff = now.toISOString().slice(0, 10);
    for (const episode of old.episodes) {
      if (episode.isProjected || episode.isPremierePlaceholder ||
          (episode.startsAt ? Date.parse(episode.startsAt) > +now : episode.date >= cutoff)) continue;
      const current = episodes.get(episode.episodeNumber);
      if (current) {
        if (episode.startsAt && !current.startsAt && current.date === episode.date && !current.isProjected) {
          current.startsAt = episode.startsAt;
          if (!current.platforms.length) current.platforms = episode.platforms;
        }
        continue;
      }
      show.episodes.push(episode);
    }
    if (show.episodes.length) {
      show.platforms = [...new Set([...old.platforms, ...show.platforms])].sort();
      shows.set(show.id, show);
    }
  }

  for (const show of shows.values()) {
    show.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
  }
  return [...shows.values()].sort((a, b) => a.title.localeCompare(b.title));
}
