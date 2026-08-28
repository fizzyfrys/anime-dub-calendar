# 📋 Future Roadmap & To-Do List

This document tracks planned future enhancements and integrations for the Anime Dub Calendar pipeline.

---

## 🔮 Planned Enhancements

### 1. 📰 Cross-Reference r/Animedubs RSS & Subreddit Data
- [ ] **Ingest r/Animedubs RSS Feed** (`https://www.reddit.com/r/Animedubs/.rss` / Reddit API).
- [ ] **Weekly Megathreads & Discussion Tracking**:
  - Automatically parse the community weekly dub release schedule threads for newly announced dub casts and premiere dates.
- [ ] **Early Delay / Hiatus Detection**:
  - Catch emergency broadcast delays, production breaks, or holiday skip weeks reported in the subreddit before the MAL forum thread is updated.
- [ ] **Surprise Batch Drop Alerts**:
  - Detect surprise full-season / multi-episode batch drops (e.g. Netflix, Crunchyroll dub dumps).

---

### 2. ⏰ Cross-Reference Crunchyroll for Exact Episode Drop Times
- [ ] **Scrape / Query Crunchyroll Release Calendar**:
  - Query Crunchyroll's release calendar / API endpoints to find the exact air time of day (e.g., `12:30 PM PDT` / `3:30 PM EDT`).
- [ ] **Timed Calendar Events Option**:
  - Support converting all-day events into precise timed events with start and end times in `America/Los_Angeles` (or UTC).
- [ ] **Fuzzy Title Matching**:
  - Build a title normalizer / alias map to cleanly link MAL anime titles with Crunchyroll's localized catalog names.

---

### 3. 🌐 Additional Platform Time Cross-Referencing
- [ ] **HIDIVE Dub Schedule**: Query HIDIVE weekly dub releases for accurate drop times.
- [ ] **Netflix / Hulu / Disney+**: Track global binge drops vs. weekly broadcast streaming dubs.
