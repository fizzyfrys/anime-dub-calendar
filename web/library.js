import {
  civilDay, hasShow, includesEpisode, isReleased, localDay, mergeImport,
  parseImport, profileIds, readImport, watchProgress, weekDays,
} from './library-data.js';

const $ = id => document.getElementById(id);
const dayFormat = new Intl.DateTimeFormat([], { weekday: 'long', month: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const statusNames = {
  '': 'Not tracked', watching: 'Watching', planned: 'Plan to watch', completed: 'Completed',
  paused: 'On hold', dropped: 'Dropped', rewatching: 'Rewatching',
};
const state = { catalog: null, metadata: {}, profile: null, key: '', offset: 0 };
const notice = text => { $('notice').textContent = text; };

function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

const link = (text, url) => el('a', text, { href: url });
function button(label, run) {
  const node = el('button', label, { type: 'button' });
  node.addEventListener('click', run);
  return node;
}

const titleLink = show => link(show.title, `#show/${show.id}`);
const metadata = show => state.metadata[show.id] ?? {};
const labelDay = date => dayFormat.format(new Date(date + 'T12:00:00'));
const selected = show => hasShow(state.profile?.selected ?? [], show);
const hidden = show => hasShow(state.profile?.hidden ?? [], show);
const ordered = episodes => episodes.sort((a, b) =>
  (a.episode.startsAt ? Date.parse(a.episode.startsAt) : Infinity) -
  (b.episode.startsAt ? Date.parse(b.episode.startsAt) : Infinity) ||
  a.show.title.localeCompare(b.show.title) || a.episode.episodeNumber - b.episode.episodeNumber);

function matches(show) {
  const query = $('search').value.trim().toLocaleLowerCase();
  const genre = $('genre').value.trim().toLocaleLowerCase();
  return show.title.toLocaleLowerCase().includes(query) &&
    (!$('platform').value || show.platforms.includes($('platform').value)) &&
    (!genre || metadata(show).tags?.some(tag => tag.toLocaleLowerCase().includes(genre)));
}

function markHidden(show) {
  const remove = hidden(show);
  return button(remove ? 'Restore show' : 'Hide show', () => save(profile => {
    profile.hidden = remove ? profile.hidden.filter(id => !profileIds(show).includes(id)) :
      [...profile.hidden, show.id];
  }, remove ? `${show.title} restored.` : `${show.title} hidden from your feed.`));
}

function episodeText(episode, date = false) {
  const timing = episode.startsAt ? timeFormat.format(new Date(episode.startsAt)) : 'Time not listed';
  const labels = [`Episode ${episode.episodeNumber}`, timing];
  if (date) labels.splice(1, 0, labelDay(localDay(episode)));
  if (episode.isResumeEvent) labels.push('Resumes');
  else if (episode.isProjected || (episode.isPremierePlaceholder && !episode.dateConfirmed)) labels.push('Estimated');
  if (episode.platforms.length) labels.push(episode.platforms.join(', '));
  return labels.join(' · ');
}

function rows() { return el('ul', null, { class: 'rows' }); }

function week(root, shows, now) {
  const days = weekDays(now, state.offset);
  const today = civilDay(now);
  const heading = el('div', null, { class: 'week-heading' });
  heading.append(el('h2', state.offset === 0 ? 'Upcoming week' : `${labelDay(days[0])} – ${labelDay(days[6])}`));
  const actions = el('div', null, { class: 'actions' });
  const shift = (label, offset) => button(label, () => { state.offset = offset; render(); });
  actions.append(shift('Previous', state.offset - 1), shift('Today', 0), shift('Next', state.offset + 1));
  heading.append(actions);
  root.append(heading, el('p', `Times shown in ${timeFormat.resolvedOptions().timeZone}.`, { class: 'hint' }));
  const groups = new Map(days.map(day => [day, []]));
  for (const show of shows) for (const episode of show.episodes) {
    const platforms = episode.platforms.length ? episode.platforms : show.platforms;
    if ((!$('platform').value || platforms.includes($('platform').value)) &&
        includesEpisode(state.profile, show, episode)) groups.get(localDay(episode))?.push({ show, episode });
  }
  for (const [day, episodes] of groups) {
    if (day !== today && !episodes.length) continue;
    const section = el('section', null, { class: day === today ? 'day today' : 'day' });
    section.append(el('h3', (day === today ? 'Today · ' : '') + labelDay(day)));
    if (episodes.length) {
      const list = rows();
      for (const { show, episode } of ordered(episodes)) {
        const row = el('li', null, { class: 'row' });
        const info = el('div');
        info.append(titleLink(show), el('small', episodeText(episode), { class: 'meta' }));
        row.append(info);
        if (state.profile) row.append(markHidden(show));
        list.append(row);
      }
      section.append(list);
    } else section.append(el('p', 'No matching releases today.', { class: 'hint' }));
    root.append(section);
  }
  if (![...groups.values()].some(group => group.length)) {
    root.append(el('p', 'No releases match this week.', { class: 'hint' }));
  }
}

function showsView(root, shows, view, now) {
  root.append(el('h2', { shows: 'Shows', behind: 'Behind', hidden: 'Hidden shows' }[view]));
  if (!state.profile && view !== 'shows') {
    root.append(el('p', 'Unlock the personal feed to use this view.', { class: 'hint' }));
    return;
  }
  const list = rows();
  for (const show of shows) {
    const { progress, status } = watchProgress(state.profile, show);
    const available = show.episodes.filter(ep => ep.episodeNumber > progress && isReleased(ep, now));
    if (view === 'hidden' ? !hidden(show) : hidden(show)) continue;
    if (view === 'behind' && (!available.length ||
        (!selected(show) && !['watching', 'rewatching'].includes(status)) ||
        ['paused', 'completed', 'dropped'].includes(status))) continue;
    const row = el('li', null, { class: 'row' });
    const info = el('div');
    const description = view === 'behind' ? `${available.length} recorded episode(s) behind · watched through ${progress}` :
      [show.airing ? 'Currently airing' : '', show.platforms.join(', '), statusNames[status]]
        .filter(Boolean).join(' · ');
    info.append(titleLink(show), el('small', description, { class: 'meta' }));
    row.append(info);
    if (state.profile) row.append(markHidden(show));
    list.append(row);
  }
  root.append(list.children.length ? list : el('p', 'No matching shows.', { class: 'hint' }));
}

function showView(root, show, now) {
  if (!show) { root.append(el('p', 'This show is not in the catalog.')); return; }
  root.append(link('← All shows', '#shows'));
  const details = el('article', null, { class: 'show-detail' });
  const title = el('div', null, { class: 'show-title' });
  const meta = metadata(show);
  if (meta.image) title.append(el('img', null, { class: 'cover', src: meta.image, alt: '', loading: 'lazy' }));
  const info = el('div');
  info.append(el('h2', show.title));
  if (show.malId || meta.malId) info.append(link('MyAnimeList', `https://myanimelist.net/anime/${show.malId || meta.malId}`));
  if (meta.aniListId) info.append(' · ', link('AniList', `https://anilist.co/anime/${meta.aniListId}`));
  if (meta.tags?.length) info.append(el('p', meta.tags.join(', '), { class: 'meta' }));
  title.append(info);
  details.append(title, el('h3', 'Where to watch'), el('p', show.platforms.length
    ? show.platforms.join(', ') + ' (availability may vary by region)'
    : 'No platform listed by the release source.'));
  const { progress, status } = watchProgress(state.profile, show);
  if (state.profile) {
    const actions = el('div', null, { class: 'actions tracking' });
    actions.append(markHidden(show), button(selected(show) ? 'Deselect show' : 'Select show', () => save(profile => {
      profile.selected = selected(show) ? profile.selected.filter(id => !profileIds(show).includes(id)) :
        [...profile.selected, show.id];
    })));
    const select = el('select', null, { 'aria-label': 'Watch status' });
    for (const [value, label] of Object.entries(statusNames)) select.append(el('option', label, { value }));
    select.value = status;
    const count = el('input', null, { type: 'number', value: progress, min: '0', max: '10000', required: '', 'aria-label': 'Episodes watched' });
    actions.append(select, count, button('Save progress', () => {
      if (!count.checkValidity() || !Number.isInteger(count.valueAsNumber)) {
        count.reportValidity();
        return;
      }
      return save(profile => { profile.watching[show.id] = { status: select.value, progress: count.valueAsNumber }; });
    }));
    details.append(actions);
  }
  details.append(el('h3', 'Episode history'));
  const list = rows();
  for (const episode of [...show.episodes].reverse()) {
    const row = el('li', null, { class: 'row' });
    row.append(el('span', episodeText(episode, true)));
    if (state.profile && episode.episodeNumber <= progress) row.append(el('small', 'Watched', { class: 'meta' }));
    else if (state.profile && isReleased(episode, now)) {
      row.append(button(`Watched through ep ${episode.episodeNumber}`, () => save(profile => {
        profile.watching[show.id] = { status: status || 'watching', progress: episode.episodeNumber };
      })));
    }
    list.append(row);
  }
  details.append(list.children.length ? list : el('p', 'No episodes recorded yet.', { class: 'hint' }));
  root.append(details);
}

function render() {
  if (!state.catalog) return;
  const hash = location.hash.slice(1);
  const view = ['shows', 'behind', 'hidden'].includes(hash) ? hash : hash.startsWith('show/') ? 'show' : 'week';
  for (const a of document.querySelectorAll('[data-view]')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  $('filters').hidden = ['show', 'hidden'].includes(view);
  const root = $('content');
  const now = new Date();
  const shows = view === 'hidden' ? state.catalog : state.catalog.filter(matches);
  root.replaceChildren();
  if (view === 'show') showView(root, state.catalog.find(s => profileIds(s).includes(hash.slice(5))), now);
  else if (view === 'week') week(root, shows, now);
  else showsView(root, shows, view, now);
}

function renderSettings(feedPath) {
  $('unlock').hidden = Boolean(state.profile);
  $('profile').hidden = !state.profile;
  if (!state.profile) return;
  $('feed').value = new URL(feedPath, location.href).href;
  $('only-selected').checked = state.profile.onlySelected;
  const root = $('feed-platforms');
  root.replaceChildren();
  const platforms = new Set([...(state.catalog ?? []).flatMap(show => show.platforms), ...state.profile.platforms]);
  for (const platform of [...platforms].sort()) {
    const label = el('label');
    const input = el('input', null, { type: 'checkbox' });
    input.checked = state.profile.platforms.includes(platform);
    input.addEventListener('change', () => save(profile => {
      profile.platforms = input.checked ? [...profile.platforms, platform] : profile.platforms.filter(p => p !== platform);
    }));
    label.append(input, ' ' + platform);
    root.append(label);
  }
}

async function api(key, profile) {
  const response = await fetch('./api/profile', {
    method: profile ? 'PUT' : 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${key}`,
      ...(profile ? { 'Content-Type': 'application/json', 'If-Match': state.version } : {}) },
    ...(profile ? { body: JSON.stringify(profile) } : {}),
  });
  if (response.status === 401) throw new Error('Calendar access key not accepted.');
  if (response.status === 412) {
    applyProfile(await api(key));
    throw new Error('Your profile changed on another device. Try the change again.');
  }
  if (!response.ok) throw new Error('The personal calendar is unavailable or could not save these changes.');
  return { ...await response.json(), version: response.headers.get('ETag') };
}

function applyProfile(result) {
  state.profile = result.profile;
  state.feedPath = result.feedPath;
  state.version = result.version;
  renderSettings(state.feedPath);
  render();
}

async function unlock(key) {
  const result = await api(key);
  state.key = key;
  try { sessionStorage.setItem('calendar-key', key); } catch {}
  applyProfile(result);
}

async function save(change, success = 'Personal calendar saved.') {
  if (state.saving || !state.profile) return;
  state.saving = true;
  const profile = structuredClone(state.profile);
  try {
    change(profile);
    const result = await api(state.key, profile);
    if (!state.key) return;
    applyProfile(result);
    notice(success);
  } catch (error) {
    renderSettings(state.feedPath);
    notice(error.message);
  } finally {
    state.saving = false;
  }
}

$('unlock').addEventListener('submit', async event => {
  event.preventDefault();
  try { await unlock($('key').value.trim()); $('key').value = ''; notice('Personal calendar unlocked.'); }
  catch (error) { notice(error.message); }
});
$('lock').addEventListener('click', () => {
  if (state.saving) return;
  try { sessionStorage.removeItem('calendar-key'); } catch {}
  state.profile = null;
  state.key = state.feedPath = $('feed').value = '';
  renderSettings();
  render();
  notice('Personal calendar locked.');
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('feed').value); notice('Subscription URL copied.'); }
  catch { $('feed').select(); notice('Copy the selected URL.'); }
});
$('only-selected').addEventListener('change', event => save(profile => { profile.onlySelected = event.target.checked; }));
$('import').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file || !state.catalog || !state.profile) return;
  try {
    const rows = parseImport(await readImport(file));
    if (!state.profile) return;
    const result = mergeImport(state.profile, rows, state.catalog, state.metadata);
    if (!result.matched) throw new Error('No shows in this export match the current catalog.');
    await save(profile => Object.assign(profile, result.profile, { onlySelected: true }),
      `Imported ${result.matched} matching show(s). Your feed is now set to selected shows only.`);
  } catch (error) {
    notice(error.message);
  } finally {
    event.target.value = '';
  }
});
for (const id of ['search', 'platform', 'genre']) $(id).addEventListener('input', render);
window.addEventListener('hashchange', render);

async function loadCatalog() {
  const response = await fetch('./catalog.json');
  if (!response.ok) throw new Error('Schedule is not ready.');
  const result = await response.json();
  state.catalog = result.catalog;
  for (const platform of [...new Set(state.catalog.flatMap(show => show.platforms))].sort()) {
    $('platform').append(el('option', platform, { value: platform }));
  }
  renderSettings(state.feedPath);
  render();
  const extra = await fetch('./catalog-metadata.json');
  if (!extra.ok) return;
  state.metadata = (await extra.json()).shows;
  const genres = new Set(state.catalog.flatMap(show => metadata(show).tags ?? []));
  for (const tag of [...genres].sort()) $('genres').append(el('option', null, { value: tag }));
  render();
}
loadCatalog().catch(() => {
  if (!state.catalog) $('content').replaceChildren(el('p', 'Schedule unavailable. Try reloading after the first successful refresh.'));
});
try {
  const key = sessionStorage.getItem('calendar-key');
  if (key) unlock(key).catch(error => notice(error.message));
} catch {}

if ('serviceWorker' in navigator && isSecureContext) {
  navigator.serviceWorker.register('./calendar-sw.js').catch(() => {});
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  $('install').hidden = false;
  $('install').onclick = async () => { await event.prompt(); $('install').hidden = true; };
});
