# Publishing the GitHub Pages feeds from Docker

By default, a GitHub Actions workflow rebuilds the calendar every day and commits the new feeds to `docs/`, which GitHub Pages serves at <https://fizzyfrys.github.io/anime-dub-calendar/>.

This guide moves that job to your own Docker container. The container builds the calendar, serves it on your network as usual, and pushes the same files to GitHub after each refresh. The public site and both subscription URLs stay the same, so existing subscribers notice nothing.

You do not need to open any ports. The container only makes outgoing requests to the GitHub API.

## How it works

On startup and every day at 10:00 UTC, the container:

1. Downloads `docs/state.json` from `main`, so it continues from the same episode history as the public feeds.
2. Builds the calendar and updates the copy it serves locally.
3. Commits the two `.ics` feeds, `schedule.json` and `state.json` to `main:/docs` in one commit, `chore: update anime dub calendar from Docker`. Nothing is committed when the files have not changed.

GitHub Pages then redeploys the site, which takes a few minutes.

## Before you start

- The container already runs as described in [Run with Docker](README.md#run-with-docker).
- You are signed in to GitHub as the account that owns the repository.

## 1. Create a GitHub token

1. Open [new fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
2. Under **Repository access**, choose **Only select repositories** and pick `anime-dub-calendar`.
3. Under **Permissions**, set **Contents** to **Read and write**. Leave everything else at **No access**.
4. Pick an expiration date and note it. Publishing stops when the token expires, and you repeat this step.
5. Generate the token and copy it.

## 2. Save the token to a file on the Docker host

The container reads the token from a file, so it never appears in the Docker configuration or the logs. Keep the file outside the container's data volume.

```sh
mkdir -p /mnt/user/appdata/anime-dub-calendar
read -rsp 'Paste token: ' token && printf '%s' "$token" > /mnt/user/appdata/anime-dub-calendar/github-token; unset token; echo
chown 1000:1000 /mnt/user/appdata/anime-dub-calendar/github-token
chmod 600 /mnt/user/appdata/anime-dub-calendar/github-token
```

`read -s` takes the token without echoing it, so it never lands in your shell history. Use any path you like; the example uses the usual Unraid appdata location. The `chown` matters: the container runs as UID `1000`, and with mode `600` only that user can read the file.

## 3. Stop the GitHub Actions build

Only one publisher should write to `docs/`, or the two will overwrite each other.

1. Open the repository's [Actions variables](https://github.com/fizzyfrys/anime-dub-calendar/settings/variables/actions).
2. Add a repository variable named `CALENDAR_PUBLISHER` with the value `external`.
3. If [Build Anime Dub Calendar](https://github.com/fizzyfrys/anime-dub-calendar/actions/workflows/build.yml) is running, wait for it to finish.

From now on, the scheduled workflow is skipped.

## 4. Turn on publishing in the container

Recreate the container with the token file mounted and two extra variables:

```sh
docker rm -f anime-dub-calendar
docker run -d --pull always --name anime-dub-calendar --restart unless-stopped \
  -p 8080:8080 -v anime-dub-calendar-data:/data \
  -v /mnt/user/appdata/anime-dub-calendar/github-token:/run/secrets/github-publish-token:ro \
  -e GITHUB_PUBLISH_REPOSITORY=fizzyfrys/anime-dub-calendar \
  -e GITHUB_PUBLISH_TOKEN_FILE=/run/secrets/github-publish-token \
  ghcr.io/fizzyfrys/anime-dub-calendar:latest
```

On Unraid, edit the container template instead: add a **Path** that maps the token file to `/run/secrets/github-publish-token` (read only), and add the two **Variables** above.

## 5. Check that it worked

The container refreshes as soon as it starts. Open its logs and look for one of:

- `Published feeds to fizzyfrys/anime-dub-calendar@<commit>`: the commit is on `main`. Watch the [Pages deployment](https://github.com/fizzyfrys/anime-dub-calendar/actions/workflows/pages/pages-build-deployment) to see when the site updates.
- `Feeds already published`: nothing changed since the last commit, which is also fine.

## When something goes wrong

The public feeds never break; at worst they stop updating until the problem is fixed.

| Log message | What it means | What to check |
| --- | --- | --- |
| `Could not read published history; skipping GitHub publish` | The container could not read `main` from GitHub. It still refreshes the local copy from its own cache. | The token has expired, was revoked, or lacks access to the repository; the file path is wrong or unreadable; or the host is offline. |
| `GitHub publish failed; local feeds updated` | The build worked but the push did not. Pages keeps the last published feeds. | The token lacks **Contents: Read and write**, or someone pushed to `main` during the refresh. The next refresh tries again. |
| `Set GITHUB_PUBLISH_REPOSITORY (owner/repo) and GITHUB_PUBLISH_TOKEN_FILE together` | Only one of the two variables is set, or the repository name is not `owner/repo`. | Both variables in step 4. |

To retry without waiting for 10:00 UTC, restart the container.

## Switch back to GitHub Actions

1. Remove `GITHUB_PUBLISH_REPOSITORY` and `GITHUB_PUBLISH_TOKEN_FILE` from the container and restart it. It keeps serving the calendar locally.
2. Delete the `CALENDAR_PUBLISHER` variable from the [Actions variables](https://github.com/fizzyfrys/anime-dub-calendar/settings/variables/actions).
3. Run [Build Anime Dub Calendar](https://github.com/fizzyfrys/anime-dub-calendar/actions/workflows/build.yml) once to publish immediately.

You can then delete the token on GitHub and the token file on the host.

## Using a fork

The same steps work for your own fork: replace `fizzyfrys/anime-dub-calendar` with your repository everywhere, and enable GitHub Pages for `main` with the `/docs` folder.
