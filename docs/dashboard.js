import { civilDay, element, groupWeek, renderWeek, scheduleEpisodes, timeFormat, weekDays } from './calendar-week.js';
import { feedBaseUrl } from './feed-url.js';

const $ = id => document.getElementById(id);
const base = feedBaseUrl(location.origin, location.pathname);
const feedName = () => $('format').value === 'ep-first' ? 'anime-dubs-ep-first.ics' : 'anime-dubs.ics';

function updateLinks() {
  const filename = feedName();
  const webcal = (base + filename).replace(/^https?:\/\//, 'webcal://');
  $('gcal-btn').href = 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal);
  $('webcal-btn').href = webcal;
  $('download-btn').href = base + filename;
  $('download-btn').download = filename;
}

$('format').addEventListener('change', updateLinks);
$('copy-btn').addEventListener('click', async () => {
  const url = base + feedName();
  try {
    await navigator.clipboard.writeText(url);
    $('copy-toast').textContent = 'Feed URL copied.';
  } catch {
    window.prompt('Copy this calendar feed URL:', url);
  }
});
updateLinks();

async function loadSchedule() {
  const response = await fetch(base + 'schedule.json');
  if (!response.ok) throw new Error('Schedule unavailable');
  const data = await response.json();
  const now = new Date();
  const days = weekDays(now);
  const groups = groupWeek(days, scheduleEpisodes(data, days).map(episode => ({ title: episode.title, episode })));
  const calendar = renderWeek(groups, civilDay(now), ({ title, episode }) => {
    const timing = episode.startsAt ? timeFormat.format(new Date(episode.startsAt)) : 'Time not listed';
    const info = element('div');
    const labels = episode.usualDay ? ['Usual release day · episode not confirmed'] : [
      episode.resumes ? 'Resumes' : `Episode ${episode.episodeNumber}`, timing,
      episode.projected ? 'Estimated' : '', ...(episode.platforms ?? []),
    ];
    info.append(element('strong', title), element('small', labels.filter(Boolean).join(' · '), { class: 'calendar-muted' }));
    return [info];
  });
  $('schedule-container').replaceChildren(calendar);
  if (data.generatedAt && Number.isFinite(Date.parse(data.generatedAt))) {
    $('last-updated').textContent = 'Schedule updated ' + new Date(data.generatedAt).toLocaleString();
  }
}

$('timezone').textContent = `Times shown in ${timeFormat.resolvedOptions().timeZone}`;
loadSchedule().catch(() => { $('schedule-container').textContent = 'Schedule unavailable. Try again later.'; });
