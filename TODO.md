# 📋 Future Roadmap & To-Do List

This document tracks planned features and future ideas for the Anime Dub Calendar pipeline.

---

## 🎯 Definite Planned Features

### 1. 📰 Cross-Reference r/Animedubs RSS & Subreddit Data

- [ ] **Ingest r/Animedubs RSS Feed** (`https://www.reddit.com/r/Animedubs/.rss` / Reddit API).
- [ ] **Weekly Megathreads & Discussion Tracking**:
  - Automatically parse community weekly dub release schedule threads for newly announced dub casts and premiere dates.
- [ ] **Early Delay / Hiatus Detection**:
  - Catch emergency broadcast delays, production breaks, or holiday skip weeks reported in the subreddit before the MAL forum thread updates.
- [ ] **Surprise Batch Drop Alerts**:
  - Detect surprise full-season / multi-episode batch drops.

---

### 2. ⏰ Cross-Reference Crunchyroll for Exact Episode Drop Times

- [ ] **Scrape / Query Crunchyroll Release Calendar**:
  - Query Crunchyroll's release calendar / API endpoints to find exact air times (e.g., `12:30 PM PDT` / `3:30 PM EDT`).
- [ ] **Timed Calendar Events Option**:
  - Support converting all-day events into precise timed events with start/end timestamps.
  - Add optional 15-minute / 30-minute reminder notifications for episode drops.
- [ ] **Fuzzy Title Matching**:
  - Build a title normalizer / alias map to cleanly link MAL anime titles with Crunchyroll's localized catalog names.

---

### 3. 📦 Clean Batch / Binge-Drop Grouping

- [ ] **Group Multi-Episode / Full-Season Drops into Single Events**:
  - When an entire season or multi-episode batch drops at once (e.g. Netflix batch releases, catalog dub dumps):
  - Consolidate into **1 clean calendar event** (e.g., `Solo Leveling (Full Batch: Eps 1–12)`) instead of spamming 12–24 individual events on a single day.

---

### 4. 🌐 Additional Platform Time Cross-Referencing

- [ ] **HIDIVE Dub Schedule**: Query HIDIVE weekly dub releases for accurate drop times.
- [ ] **Netflix / Hulu / Disney+**: Track global binge drop times vs. weekly broadcast streaming dubs.

---

## 💡 Other Ideas

- [ ] **🏁 Finale Badges (`Season Finale` / `Series Finale`)**:
  - When an episode reaches the known total (e.g., `Ep 12/12` or `Ep 24/24`), append `(Season Finale)` to the event summary.
- [ ] **📺 Platform-Specific Filtered Feeds**:
  - Publish service-filtered `.ics` files (`anime-dubs-crunchyroll.ics`, `anime-dubs-hidive.ics`, `anime-dubs-netflix.ics`) for users who only subscribe to specific streaming platforms.
- [ ] **🏖️ Holiday & Break Week Warnings**:
  - Automatically flag projected slots during major industry holiday weeks (Thanksgiving week, Christmas / New Year's, Golden Week) with a delay caution note.
- [ ] **📱 App Deep Links in Event Descriptions**:
  - Include direct mobile deep links that open directly inside the native Crunchyroll / HIDIVE / Netflix app when tapped from calendar notifications.
