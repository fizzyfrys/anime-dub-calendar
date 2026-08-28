# Anime Dub Calendar

Auto-updated weekly anime English dub release calendar, sourced from the [MAL Upcoming Dubbed Anime forum thread](https://myanimelist.net/forum/?topicid=1692966) and published as a live `.ics` subscription feed.

## Subscribe

| Client | Link |
|---|---|
| Google Calendar | `https://<your-pages-url>/anime-dubs.ics` (see setup below) |
| Apple Calendar / iOS | Click the Webcal link on the landing page |
| Outlook / Windows | Add calendar from URL |

---

## How It Works

1. **Daily GitHub Action** fetches the MAL forum thread HTML.
2. **Parser** extracts the weekly schedule: show title, MAL URL, broadcast day, and episode progress (`current/total`).
3. **Cour projection engine** predicts remaining episode dates using anime cour heuristics:
   - Known totals: project all remaining episodes.
   - Unknown `??`: 1-cour (12 eps), 2-cour (24 eps), rolling buffers at boundaries, +4 rolling for long-runners.
   - Multi-episode drops detected and emitted as same-day events.
4. **ICS generator** produces a standards-compliant calendar file with deterministic event UIDs, ensuring clean updates without duplicates.
5. **GitHub Pages** serves `docs/anime-dubs.ics` at a public HTTPS URL.

---

## Deployment

### 1. Fork / Clone this repo

```bash
git clone https://github.com/<you>/anime-dub-cal.git
cd anime-dub-cal
npm install
```

### 2. Enable GitHub Pages

In your repo: **Settings → Pages → Source → Deploy from branch → `main` → `/docs`**

Your calendar feed URL will be:
```
https://<username>.github.io/<repo-name>/anime-dubs.ics
```

### 3. Enable GitHub Actions

Actions should run automatically on push. To trigger manually:
**Actions → Build Anime Dub Calendar → Run workflow**

### 4. Subscribe in Google Calendar

1. Go to [Google Calendar](https://calendar.google.com) → **+ Other calendars → From URL**
2. Paste your Pages URL: `https://<username>.github.io/<repo-name>/anime-dubs.ics`
3. Click **Add Calendar**

Google will poll for updates approximately every 24 hours.

### Subscribe via Webcal (Apple Calendar, iOS)

Click the **Subscribe via Webcal** button on the landing page, or manually add:
```
webcal://<username>.github.io/<repo-name>/anime-dubs.ics
```

---

## Local Development

```bash
# Parse the local saved HTML snapshot
npm run build:local

# Fetch live from MAL
npm run build

# Run tests
npm test
```

---

## Episode Projection Logic

| Situation | Projection |
|---|---|
| `8/12` — known total | Projects eps 9–12 on broadcast weekday |
| `8/?` — unknown, ep < 12 | Predicts 1-cour total of 12; projects eps 9–12 |
| `13/??` — at 1-cour boundary | +2 episode rolling buffer (eps 14, 15) |
| `19/??` — between 12 and 24 | Predicts 2-cour total of 24; projects eps 20–24 |
| `24/??` — at 2-cour boundary | +2 episode rolling buffer (eps 25, 26) |
| `118/???` — long-runner | Rolling +4 upcoming episodes only |
| `**` — suspended | No future projections; flagged in event description |
| `++` — resumed | Projections anchored to resume date |
| Counter jumped >1 in fresh post | All dropped eps emitted as events on same day |

---

## Data Source

Community-maintained MAL forum: [Upcoming Dubbed Anime](https://myanimelist.net/forum/?topicid=1692966)

This project is not affiliated with MyAnimeList.
