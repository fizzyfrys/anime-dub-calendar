export function civilDay(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(value => String(value).padStart(2, '0')).join('-');
}

export function localDay(episode) {
  return episode.startsAt ? civilDay(new Date(episode.startsAt)) : episode.date;
}

export function weekDays(now, offset = 0) {
  return Array.from({ length: 7 }, (_, i) =>
    civilDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset * 7 + i, 12)));
}

export function groupWeek(days, entries) {
  const groups = new Map(days.map(day => [day, []]));
  for (const entry of entries) groups.get(localDay(entry.episode))?.push(entry);
  for (const entries of groups.values()) entries.sort((a, b) =>
    (a.episode.startsAt ? Date.parse(a.episode.startsAt) : Infinity) -
    (b.episode.startsAt ? Date.parse(b.episode.startsAt) : Infinity) ||
    a.title.localeCompare(b.title) || a.episode.episodeNumber - b.episode.episodeNumber);
  return groups;
}

export function element(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

export const dayFormat = new Intl.DateTimeFormat([], { weekday: 'long', month: 'short', day: 'numeric' });
export const timeFormat = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
export const labelDay = day => dayFormat.format(new Date(day + 'T12:00:00'));

export function renderWeek(groups, today, renderEntry) {
  const grid = element('div', null, { class: 'week-grid' });
  for (const [day, entries] of groups) {
    const current = day === today;
    const id = 'date-' + day;
    const card = element('section', null, { class: current ? 'date-card is-today' : 'date-card', 'aria-labelledby': id });
    const header = element('div', null, { class: 'date-heading' });
    const heading = element('h3', null, { id });
    heading.append(element('time', labelDay(day), { datetime: day, ...(current ? { 'aria-current': 'date' } : {}) }));
    header.append(heading);
    if (current) header.append(element('span', 'Today', { class: 'today-pill' }));
    card.append(header);
    if (entries.length) {
      const list = element('ul', null, { class: 'week-releases' });
      for (const entry of entries) {
        const row = element('li', null, { class: 'week-release' });
        row.append(...renderEntry(entry));
        list.append(row);
      }
      card.append(list);
    } else {
      card.append(element('p', 'No releases listed', { class: 'calendar-muted date-empty' }));
    }
    grid.append(card);
  }
  return grid;
}
