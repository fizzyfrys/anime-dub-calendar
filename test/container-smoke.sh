#!/usr/bin/env bash
set -Eeuo pipefail

image=${1:?Pass the Docker image tag to test}
fixtures=$(mktemp -d)
suffix=${fixtures##*.}
name="dub-calendar-smoke-${suffix,,}"
volume="$name"
compose_image="ghcr.io/fizzyfrys/anime-dub-calendar:$name"
compose=(docker compose --env-file /dev/null -p "$name" -f compose.yml -f "$fixtures/compose-test.yml")
cleanup() {
  if [[ -f "$fixtures/compose-test.yml" ]]; then "${compose[@]}" down -v >/dev/null 2>&1 || true; fi
  docker image rm "$compose_image" >/dev/null 2>&1 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -r "$fixtures"
}
trap cleanup EXIT
trap 'echo "Container smoke test failed at line $LINENO" >&2; docker logs "$name" >&2 || true' ERR

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
touch "$fixtures/empty-token"
chmod a+r "$fixtures/empty-token"
printf 'fixture-token\n' >"$fixtures/mock-token"
personal_key=fixture-0123456789abcdef0123456789abcdef
printf '%s\n' "$personal_key" >"$fixtures/calendar-key"
cat >"$fixtures/metadata.json" <<'EOF'
{"data":[{"title":"Container Test","sources":["https://myanimelist.net/anime/1","https://anilist.co/anime/100"],"tags":["comedy"]}]}
EOF
cat >"$fixtures/mock-github.mjs" <<'EOF'
const responses = {
  'GET git/ref/heads/main': { object: { sha: 'history-commit' } },
  'GET git/commits/history-commit': { tree: { sha: 'base-tree' } },
  'GET contents/docs/state.json?ref=history-commit': {
    shows: {}, history: { 'container-test': { 1: '2025-01-06' } },
  },
  'POST git/trees': { sha: 'updated-tree' },
  'POST git/commits': { sha: 'new-commit' },
  'PATCH git/refs/heads/main': { object: { sha: 'new-commit' } },
};
globalThis.fetch = async (url, { method, body }) => {
  const path = url.replace('https://api.github.com/repos/example/calendar/', '');
  const result = responses[`${method} ${path}`];
  if (!result) throw new Error(`Unexpected fixture request: ${method} ${url}`);
  if (path === 'git/trees') {
    const tree = JSON.parse(body).tree;
    const files = tree.map(file => file.path).sort().join(',');
    if (files !== 'docs/anime-dubs-ep-first.ics,docs/anime-dubs.ics,docs/schedule.json,docs/state.json') {
      throw new Error('Publish must only update the four public calendar files');
    }
    const state = JSON.parse(tree.find(file => file.path === 'docs/state.json').content);
    if (state.history['container-test']?.[1] !== '2025-01-06') {
      throw new Error('Published history does not contain the previously recorded episode');
    }
  }
  return Response.json(result);
};
EOF
chmod a+r "$fixtures/mock-token" "$fixtures/mock-github.mjs" "$fixtures/calendar-key" "$fixtures/metadata.json"

docker volume create "$volume" >/dev/null
start() {
  docker run -d --rm --name "$name" -p 127.0.0.1::8080 \
    -v "$volume:/data" -v "$fixtures:/fixtures:ro" \
    -e "MAL_HTML_PATH=/fixtures/$1" -e "DUB_CALENDAR_HTML_PATH=/fixtures/$2" \
    -e "GITHUB_PUBLISH_REPOSITORY=${3:-}" -e "GITHUB_PUBLISH_TOKEN_FILE=${4:-}" \
    -e "NODE_OPTIONS=${5:-}" \
    -e "CALENDAR_ACCESS_KEY_FILE=${6:-}" -e "CALENDAR_METADATA_PATH=/fixtures/metadata.json" \
    "$image" >/dev/null
  for _ in $(seq 1 30); do
    if docker logs "$name" 2>&1 | grep -F '[calendar-server] Next refresh:' >/dev/null; then
      base="http://$(docker port "$name" 8080/tcp)"
      return
    fi
    sleep 1
  done
  docker logs "$name"
  return 1
}

assert_refreshed() {
  if docker logs "$name" 2>&1 | grep -F '[calendar-server] Refresh failed:' >/dev/null; then
    docker logs "$name" >&2
    return 1
  fi
}

assert_feeds() {
  local feed body
  for feed in anime-dubs.ics anime-dubs-ep-first.ics; do
    body=$(curl -fsS "$base/$feed")
    grep -F "DTSTART:${date//-/}T100000Z" <<<"$body" >/dev/null
    if grep -Fq 'Hide YouTube Only' <<<"$body"; then
      echo "Filtered title found in $feed" >&2
      return 1
    fi
  done
}

assert_personal_feed_empty() {
  local body
  body=$(curl -fsS "$base/$personal_feed")
  grep -F 'BEGIN:VCALENDAR' <<<"$body" >/dev/null
  if grep -Fq 'BEGIN:VEVENT' <<<"$body"; then
    echo "Personal feed still contains events after hiding the only show" >&2
    return 1
  fi
}

start mal.html operator-has-no-snapshot.html
assert_refreshed
docker exec "$name" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  const bundled = JSON.parse(readFileSync("/app/docs/state.json", "utf8"));
  const generated = JSON.parse(readFileSync("/data/state.json", "utf8"));
  assert.ok(Object.keys(bundled.history).length);
  for (const [show, dates] of Object.entries(bundled.history)) {
    assert.deepEqual(generated.history[show], dates);
  }
  assert.ok(generated.shows["container-test"]);
'
docker stop "$name" >/dev/null

# Keep the fixture row count independent of the live scrape baseline bundled in the image.
docker run --rm -v "$volume:/data" --entrypoint node "$image" \
  -e 'require("node:fs").writeFileSync("/data/state.json", "{}")'

start mal.html dub.html
assert_refreshed
curl -fsS "$base/" | grep 'anime-dubs.ics' >/dev/null
curl -fsSI "$base/feed-url.js" | grep -i 'Content-Type: text/javascript' >/dev/null
curl -fsSI "$base/calendar-week.js" | grep -i 'Content-Type: text/javascript' >/dev/null
curl -fsSI "$base/dashboard.css" | grep -i 'Content-Type: text/css' >/dev/null
curl -fsS "$base/schedule.json" | grep -F "${date}T10:00:00.000Z" >/dev/null
curl -fsS "$base/schedule.json" | grep -F '"episodes": [' >/dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/state.json")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/profile")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/library.html")" = 404
assert_feeds
docker stop "$name" >/dev/null

start mal.html operator-has-no-snapshot.html
assert_refreshed
docker logs "$name" 2>&1 | grep -F 'Publishing MAL and cached release times' >/dev/null
assert_feeds
docker stop "$name" >/dev/null

start operator-has-no-malsnapshot.html dub.html
docker logs "$name" 2>&1 | grep -F 'Refresh failed:' >/dev/null
assert_feeds
docker stop "$name" >/dev/null

start mal.html dub.html example/calendar /fixtures/empty-token
assert_refreshed
docker logs "$name" 2>&1 | grep -F 'Could not read published history; skipping GitHub publish:' >/dev/null
assert_feeds
docker stop "$name" >/dev/null
docker volume rm "$volume" >/dev/null
docker volume create "$volume" >/dev/null

start mal.html dub.html example/calendar /fixtures/mock-token --import=/fixtures/mock-github.mjs /fixtures/calendar-key
assert_refreshed
docker logs "$name" 2>&1 | grep -F 'Published feeds to example/calendar@new-commit' >/dev/null
assert_feeds
curl -fsS "$base/anime-dubs.ics" | grep -F 'DTSTART;VALUE=DATE:20250106' >/dev/null
curl -fsS "$base/" | grep -F 'Personal feed &amp; watchlist' >/dev/null
curl -fsS "$base/index.html" | grep -F 'anime-dubs.ics' >/dev/null
curl -fsS "$base/catalog.json" | grep -F '"id":"mal-1"' >/dev/null
wait_until() {
  for _ in $(seq 1 30); do
    if "$@"; then return; fi
    sleep 1
  done
  return 1
}
metadata_loaded() { curl -fsS "$base/catalog-metadata.json" 2>/dev/null | grep -F '"aniListId":100' >/dev/null; }
wait_until metadata_loaded
curl -fsS "$base/manifest.webmanifest" | grep -F '"display": "standalone"' >/dev/null
curl -fsS "$base/calendar-icon-192.png" > /dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/personal-profile.json")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/profile")" = 401
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/personal.ics")" = 404

auth="Authorization: Bearer $personal_key"
saved=$(curl -fsS -H "$auth" "$base/api/profile")
personal_feed=$(sed -n 's/.*"feedPath":"\.\/\([^"]*\)".*/\1/p' <<<"$saved")
test -n "$personal_feed"
profile_version() {
  curl -fsS -D - -o /dev/null -H "$auth" "$base/api/profile" | awk 'tolower($1) == "etag:" { sub(/\r$/, "", $2); print $2 }'
}
version=$(profile_version)
test -n "$version"
curl -fsS "$base/$personal_feed" | grep -F "DTSTART:${date//-/}T100000Z" >/dev/null
curl -fsS -X PUT -H "$auth" -H "If-Match: $version" -H 'Content-Type: application/json' \
  -d '{"hidden":["mal-1"],"watching":{"mal-1":{"progress":1,"status":"watching"}}}' "$base/api/profile" >/dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$auth" -H "If-Match: $version" \
  -H 'Content-Type: application/json' -d '{}' "$base/api/profile")" = 412
assert_personal_feed_empty
assert_feeds
docker stop "$name" >/dev/null

start mal.html dub.html '' '' '' /fixtures/calendar-key
assert_refreshed
assert_personal_feed_empty
curl -fsS -H "$auth" "$base/api/profile" | grep -F '"progress":1' >/dev/null
curl -fsS -X PUT -H "$auth" -H "If-Match: $(profile_version)" -H 'Content-Type: application/json' \
  -d '{"hidden":[]}' "$base/api/profile" >/dev/null
curl -fsS "$base/$personal_feed" | grep -F "DTSTART:${date//-/}T100000Z" >/dev/null
docker stop "$name" >/dev/null

docker tag "$image" "$compose_image"
cat >"$fixtures/mock-watchlist.mjs" <<'EOF'
globalThis.fetch = async (url, options) => {
  if (url.origin !== 'https://api.myanimelist.net' || url.pathname !== '/v2/users/fixture-user/animelist' ||
      options.redirect !== 'error' || options.headers['X-MAL-CLIENT-ID'] !== process.env.CALENDAR_MAL_CLIENT_ID) {
    throw new Error('Invalid watchlist request');
  }
  return Response.json({ data: [
    { node: { id: 1 }, list_status: { status: 'watching', num_episodes_watched: 1 } },
  ] });
};
EOF
chmod a+r "$fixtures/mock-watchlist.mjs"
cat >"$fixtures/compose-test.yml" <<EOF
services:
  calendar:
    environment:
      MAL_HTML_PATH: /fixtures/mal.html
      DUB_CALENDAR_HTML_PATH: /fixtures/dub.html
      NODE_OPTIONS: --import=/fixtures/mock-watchlist.mjs
    volumes:
      - "$fixtures:/fixtures:ro"
volumes:
  calendar-data:
    external: true
    name: "$volume"
EOF
export CALENDAR_IMAGE_TAG="$name" CALENDAR_BIND=127.0.0.1 CALENDAR_PORT=0
export CALENDAR_PASSWORD='fixture password for compose' CALENDAR_METADATA=off
export CALENDAR_MAL_CLIENT_ID='fixture-private-client-id'
"${compose[@]}" up --pull never -d
name=$("${compose[@]}" ps -q calendar)
base="http://$("${compose[@]}" port calendar 8080)"
refresh_logged() {
  docker logs "$name" 2>&1 | grep -F '[calendar-server] Next refresh:' >/dev/null
}
wait_until refresh_logged
assert_refreshed
assert_feeds
curl -fsS "$base/" | grep -F 'Calendar password' >/dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' -H "$auth" "$base/api/profile")" = 401
test "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"password":"wrong"}' "$base/api/session")" = 401
cookies="$fixtures/cookies"
curl -fsS -c "$cookies" -D "$fixtures/headers" -H 'Content-Type: application/json' \
  -d "{\"password\":\"$CALENDAR_PASSWORD\"}" "$base/api/session" >/dev/null
grep -Ei '^Set-Cookie: .*HttpOnly; SameSite=Strict' "$fixtures/headers" >/dev/null
curl -fsS -b "$cookies" "$base/api/profile" | grep -F "$personal_feed" >/dev/null
curl -fsS "$base/$personal_feed" | grep -F "DTSTART:${date//-/}T100000Z" >/dev/null
watchlist_json='{"provider":"mal","username":"fixture-user"}'
test "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
  -d "$watchlist_json" "$base/api/watchlist")" = 401
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/watchlist-sync.json")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/personal-feed-token")" = 404
version=$(curl -fsS -D - -o /dev/null -b "$cookies" "$base/api/profile" | awk 'tolower($1) == "etag:" { sub(/\r$/, "", $2); print $2 }')
curl -fsS -b "$cookies" -X PUT -H "If-Match: $version" -H 'Content-Type: application/json' \
  -d '{"onlySelected":true}' "$base/api/profile" >/dev/null
assert_personal_feed_empty
snapshot=$(curl -fsS -b "$cookies" -X PUT -H 'Content-Type: application/json' -d "$watchlist_json" "$base/api/watchlist")
grep -F '"selected":["mal-1"]' <<<"$snapshot" >/dev/null
curl -fsS "$base/$personal_feed" | grep -F "DTSTART:${date//-/}T100000Z" >/dev/null
if grep -Fq "$CALENDAR_MAL_CLIENT_ID" <<<"$snapshot" ||
   docker logs "$name" 2>&1 | grep -F "$CALENDAR_MAL_CLIENT_ID" >/dev/null; then
  echo 'Watchlist fixture credential was exposed' >&2
  exit 1
fi
assert_feeds
curl -fsS -b "$cookies" -c "$cookies" -X DELETE "$base/api/session" >/dev/null
test "$(curl -s -b "$cookies" -o /dev/null -w '%{http_code}' "$base/api/profile")" = 401
