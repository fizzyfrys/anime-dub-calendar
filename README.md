<div align="center">

# 📅 Anime Dub Calendar

**Automated, intelligent weekly English anime dub release schedule feed.**  
Syncs episode premiere dates directly to your Google Calendar, Apple Calendar, or Outlook.

[![Build Anime Dub Calendar](https://github.com/fizzyfrys/anime-dub-calendar/actions/workflows/build.yml/badge.svg)](https://github.com/fizzyfrys/anime-dub-calendar/actions/workflows/build.yml)
[![Live Site](https://img.shields.io/badge/Live_Site-GitHub_Pages-7c5cfc?style=flat&logo=github)](https://fizzyfrys.github.io/anime-dub-calendar/)
[![Calendar Feed](https://img.shields.io/badge/Calendar-RFC_5545_.ics-e040fb?style=flat&logo=icalendar)](https://fizzyfrys.github.io/anime-dub-calendar/anime-dubs.ics)
[![Schedule](https://img.shields.io/badge/Updates-Daily_at_10:00_UTC-4ade80?style=flat&logo=clock)](https://github.com/fizzyfrys/anime-dub-calendar/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<br/>

### 🌟 [👉 Open Live Web App & Schedule Viewer 👈](https://fizzyfrys.github.io/anime-dub-calendar/)

<br/>

<!-- Subscription Buttons -->
<p align="center">
  <a href="https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Ffizzyfrys.github.io%2Fanime-dub-calendar%2Fanime-dubs.ics">
    <img src="https://img.shields.io/badge/Google_Calendar-Add_Subscription-4285F4?style=for-the-badge&logo=googlecalendar&logoColor=white" alt="Subscribe in Google Calendar" height="38"/>
  </a>
  &nbsp;
  <a href="webcal://fizzyfrys.github.io/anime-dub-calendar/anime-dubs.ics">
    <img src="https://img.shields.io/badge/Apple_Calendar-Subscribe_Webcal-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Subscribe via Webcal" height="38"/>
  </a>
  &nbsp;
  <a href="https://fizzyfrys.github.io/anime-dub-calendar/anime-dubs.ics">
    <img src="https://img.shields.io/badge/Direct_Download-.ICS_Feed-7c5cfc?style=for-the-badge&logo=icloud&logoColor=white" alt="Download .ics File" height="38"/>
  </a>
</p>

</div>

---

## ⚡ Quick Subscription Feeds

Choose your preferred format:

### 1. 🏷️ Standard Feed (`Title - Ep ##`) — *Default*
*Ideal for desktop calendar views and clean list overviews.*
- **Google Calendar**: [📅 Add Standard Feed](https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Ffizzyfrys.github.io%2Fanime-dub-calendar%2Fanime-dubs.ics)
- **Apple Calendar / Webcal**: [🍎 Subscribe via Webcal](webcal://fizzyfrys.github.io/anime-dub-calendar/anime-dubs.ics)
- **Raw URL**: `https://fizzyfrys.github.io/anime-dub-calendar/anime-dubs.ics`

### 2. 📱 Compact Feed (`Ep ## · Title`) — *Mobile & Widget Friendly*
*Guarantees episode numbers are always visible upfront without getting truncated by long anime titles.*
- **Google Calendar**: [📅 Add Compact Feed](https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Ffizzyfrys.github.io%2Fanime-dub-calendar%2Fanime-dubs-ep-first.ics)
- **Apple Calendar / Webcal**: [🍎 Subscribe via Webcal](webcal://fizzyfrys.github.io/anime-dub-calendar/anime-dubs-ep-first.ics)
- **Raw URL**: `https://fizzyfrys.github.io/anime-dub-calendar/anime-dubs-ep-first.ics`

---

## ✨ Features

- 🔄 **Fully Automated**: Runs every morning via GitHub Actions using the MyAnimeList forum and English Dubbed calendar.
- ⏰ **Local Release Times**: Published times appear in your calendar's time zone. Dates without a published time stay all-day.
- 🧠 **Cour-Aware Prediction Engine**: Automatically projects upcoming episode release dates for standard 12-episode (1 cour) and 24-episode (2 cour) broadcasts.
- 📦 **Multi-Episode Drop Detection**: Detects unannounced mid-season double/multi-episode drops and schedules them on the exact drop date.
- 🎯 **Deterministic Event UIDs**: Uses RFC 5545 compliant deterministic event IDs (`mal-dub-<slug>-ep-<n>@anime-dub-cal`) so calendar clients update existing events without duplicates.
- 🧹 **Dynamic Auto-Pruning**: When a show ends or is removed from the schedule, extra projected events are automatically purged upon the next calendar poll.
- 🌐 **Zero Server Maintenance**: Pure static hosting on GitHub Pages with GitHub Actions automation.

---

## 🛠️ How It Works

```mermaid
graph TD
    A[MAL Forum Thread\n'Upcoming Dubbed Anime'] -->|Daily GitHub Action Cron| B[HTML Parser\nsrc/parse.js]
    B -->|Current episode counts & status| C[Cour Heuristic Engine\nsrc/cour-logic.js]
    C -->|Projected dates & drop events| D[ICS Calendar Generator\nsrc/generate-ics.js]
    D -->|Published output| E[docs/anime-dubs.ics\ndocs/schedule.json]
    E -->|Served via GitHub Pages| F[Google Calendar / Apple Calendar / Outlook]
```

---

## 📐 Cour Projection Heuristics

Anime broadcast schedules frequently list unknown totals (`??`). This pipeline uses domain-aware cour heuristics:

| Current Progress | Inferred Total | Projected Episodes | Sync Lifecycle |
|---|---|---|---|
| `8/12` (Known total) | Exact (`12`) | Episodes 9–12 on broadcast weekday | Fixed projection |
| `8/??` (Unknown, `< 12`) | **1-Cour (12 eps)** | Episodes 9–12 | Adjusts if total updates |
| `13/??` (Boundary `12–13`) | **+2 buffer** | Episodes 14–15 | Rolling window while awaiting confirmation |
| `19/??` (Between `13–24`) | **2-Cour (24 eps)** | Episodes 20–24 | Adjusts to finale when confirmed |
| `24/??` (Boundary `24–25`) | **+2 buffer** | Episodes 25–26 | Rolling window for split-cour |
| `118/???` (Long-running) | Continuous | +4 weeks rolling ahead | Ongoing weekly projection |
| `**` (*Suspended*) | Frozen | No future projections | Marked in event description |
| `++` (*Resumes Date*) | Scheduled | Projections anchor to resume date | Resume date reflected on calendar |
| **Multi-Episode Drop** | Jump `> 1` within 7 days | Extra episodes placed on drop day | Emits separate events on same date |

---

## 🚀 Setup & Subscription Guide

### Google Calendar
1. Click the **[Subscribe in Google Calendar](https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Ffizzyfrys.github.io%2Fanime-dub-calendar%2Fanime-dubs.ics)** button above.
2. When Google Calendar opens, click **Add**.
3. Google Calendar will poll for updates automatically (typically every 8–24 hours).

*Manual Method:*
1. Open [Google Calendar](https://calendar.google.com) on desktop.
2. In the left sidebar, click **+** next to **Other calendars** → **From URL**.
3. Paste: `https://fizzyfrys.github.io/anime-dub-calendar/anime-dubs.ics`
4. Click **Add calendar**.

---

### Apple Calendar (iPhone, iPad, Mac)
1. Tap/click **[Subscribe via Webcal](webcal://fizzyfrys.github.io/anime-dub-calendar/anime-dubs.ics)**.
2. Calendar will open with a prompt to subscribe.
3. Choose your refresh frequency (e.g., **Every Day**) and click **Subscribe**.

---

### Microsoft Outlook
1. Open Outlook Calendar → **Add Calendar** → **Subscribe from web**.
2. Paste: `https://fizzyfrys.github.io/anime-dub-calendar/anime-dubs.ics`
3. Enter name (e.g. `Anime Dubs`) and click **Import**.

---

## Run with Docker

The container serves the site and both feeds on port `8080`. It refreshes on startup and daily at **10:00 UTC**, using MAL and English Dubbed. It keeps the previous files if the main build fails and uses cached release times and exclusions if English Dubbed is unavailable. By default it does not publish to GitHub.

```sh
docker run -d --pull always --name anime-dub-calendar --restart unless-stopped \
  -p 8080:8080 -v anime-dub-calendar-data:/data \
  ghcr.io/fizzyfrys/anime-dub-calendar:latest
```

Open `http://<docker-host>:8080/` for the site and feeds. The named volume preserves the calendar state across container replacements. If you use a bind mount instead, make the host directory writable by the container user (UID/GID `1000:1000` by default). Google Calendar cannot fetch a private LAN address; use the public Pages feed for Google Calendar.

[GitHub Actions](https://github.com/fizzyfrys/anime-dub-calendar/actions/workflows/container.yml) builds and publishes the Linux amd64 image to GHCR after smoke tests on `main`. If the package is private, [sign in to GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry) with a token that has `read:packages` before running the command.

If English Dubbed returns HTTP 403, the container logs a warning and continues with MAL and cached data. To use an authorized local copy instead, mount it in the container and set `DUB_CALENDAR_HTML_PATH` to its container path. Update the snapshot manually, or remove the variable to resume live fetches.

---

## 💻 Local Development

```bash
# 1. Clone repo
git clone https://github.com/fizzyfrys/anime-dub-calendar.git
cd anime-dub-calendar

# 2. Install dependencies
npm install

# 3. Run tests
npm test -- --runInBand

# 4. Build from both live sources
npm run build

# Or use saved HTML snapshots and leave published files untouched
node src/index.js --local mal.html --dub-calendar english-dubbed.html --output-dir /tmp/anime-dub-build
```

If the live English Dubbed fetch is blocked, you can preview a build with a saved copy of its public calendar and live MAL data. Copy `docs/state.json` into the preview directory first to keep episode history, then run `node src/index.js --dub-calendar english-dubbed.html --output-dir <preview-directory>`. To seed the next daily build, copy only the preview state's `dubCalendar` section back into `docs/state.json`. The snapshot is a one-time update; it does not restore automated access.

---

## 📚 Data Source & Disclaimer

- [MyAnimeList "Upcoming Dubbed Anime"](https://myanimelist.net/forum/?topicid=1692966) provides the baseline schedule, episode counts, and hiatuses. Later episode dates are estimates, even for shows with a known episode count.
- The [English Dubbed Anime Calendar](https://english-dubbed.com/anime-industry/english-dub-anime-calendar/) supplies published release times and additional episodes. Entries are matched by normalized title (with aliases for verified alternate names) and episode number. A conflicting confirmed MAL premiere date or hiatus takes precedence.
- Shows known to be on OceanVeil or only on YouTube are excluded from both feeds and the website. Shows without platform information still use MAL. If English Dubbed is unreachable, the build uses cached times and exclusions alongside the MAL schedule.
- The daily workflow adds a warning annotation and job summary if English Dubbed cannot be fetched, yields zero usable releases, or yields less than half as many as its last healthy run. It keeps publishing MAL and cached data without resetting that baseline.
- This project is independent and is not affiliated with either source.
