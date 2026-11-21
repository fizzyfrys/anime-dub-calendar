#!/usr/bin/env bash
set -euo pipefail

image=${1:?Pass the Docker image tag to test}
fixtures=$(mktemp -d)
name="dub-calendar-smoke-${fixtures##*.}"
volume="$name"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -r "$fixtures"
}
trap cleanup EXIT

date=$(date -u +%F)
updated=$(LC_ALL=C date -u '+%B %-d, %Y')
cat >"$fixtures/mal.html" <<EOF
<div id="msg53221626">Last Updated: <b>$updated</b><br>
<b>Currently Streaming SimulDubbed Anime - 2</b><br>
<ul><li>Sunday<ul>
<li><a href="https://myanimelist.net/anime/1">Container Test</a> (Episodes: 2/12)</li>
<li><a href="https://myanimelist.net/anime/2">Hide YouTube Only</a> (Episodes: 2/12)</li>
</ul></li></ul>
</div>
EOF
cat >"$fixtures/dub.html" <<EOF
<section class="awc-seo-day"><ul>
<li><time datetime="${date}T10:00:00Z"></time><strong>Container Test</strong><span>Episode 2</span><span class="awc-seo-services">Netflix</span></li>
<li><time datetime="${date}T11:00:00Z"></time><strong>Hide YouTube Only</strong><span>Episode 2</span><span class="awc-seo-services">YouTube</span></li>
</ul></section>
EOF
chmod a+rx "$fixtures"
chmod a+r "$fixtures/"*.html

docker volume create "$volume" >/dev/null
start() {
  docker run -d --rm --name "$name" -p 127.0.0.1::8080 \
    -v "$volume:/data" -v "$fixtures:/fixtures:ro" \
    -e "MAL_HTML_PATH=/fixtures/$1" -e "DUB_CALENDAR_HTML_PATH=/fixtures/$2" \
    "$image" >/dev/null
  for _ in $(seq 1 30); do
    if docker logs "$name" 2>&1 | grep -F 'T10:00:00.000Z' >/dev/null; then
      base="http://$(docker port "$name" 8080/tcp)"
      return
    fi
    sleep 1
  done
  docker logs "$name"
  return 1
}

assert_feeds() {
  for feed in anime-dubs.ics anime-dubs-ep-first.ics; do
    body=$(curl -fsS "$base/$feed")
    grep -F "DTSTART:${date//-/}T100000Z" <<<"$body" >/dev/null
    if grep -Fq 'Hide YouTube Only' <<<"$body"; then
      echo "Filtered title found in $feed" >&2
      return 1
    fi
  done
}

start mal.html dub.html
curl -fsS "$base/" | grep 'anime-dubs.ics' >/dev/null
curl -fsSI "$base/feed-url.js" | grep -i 'Content-Type: text/javascript' >/dev/null
curl -fsS "$base/schedule.json" | grep -F "${date}T10:00:00.000Z" >/dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/state.json")" = 404
assert_feeds
docker stop "$name" >/dev/null

start mal.html operator-has-no-snapshot.html
docker logs "$name" 2>&1 | grep -F 'Publishing MAL and cached release times' >/dev/null
assert_feeds
docker stop "$name" >/dev/null

start operator-has-no-malsnapshot.html dub.html
docker logs "$name" 2>&1 | grep -F 'Refresh failed:' >/dev/null
assert_feeds
