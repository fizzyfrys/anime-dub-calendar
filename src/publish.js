import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function publishCalendar(dir, files, { repository, tokenFile, request = fetch }) {
  if (!/^[\w-]+\/[\w-][\w.-]*$/.test(repository ?? '') || !tokenFile) {
    throw new Error('Set GITHUB_PUBLISH_REPOSITORY (owner/repo) and GITHUB_PUBLISH_TOKEN_FILE together');
  }

  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!token) throw new Error('GitHub publish token file is empty');

  async function github(method, path, payload) {
    const response = await request(`https://api.github.com/repos/${repository}/git/${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      body: payload && JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`GitHub ${method} ${path} returned HTTP ${response.status}`);
    }
    return response.json();
  }

  const tree = await Promise.all(files.map(async file => ({
    path: `docs/${file}`,
    mode: '100644',
    type: 'blob',
    content: await readFile(join(dir, file), 'utf8'),
  })));
  const { object: { sha: parent } } = await github('GET', 'ref/heads/main');
  const { tree: { sha: baseTree } } = await github('GET', `commits/${parent}`);
  const { sha: nextTree } = await github('POST', 'trees', { base_tree: baseTree, tree });
  if (nextTree === baseTree) return null;
  const { sha } = await github('POST', 'commits', {
    message: 'chore: update anime dub calendar from Unraid',
    tree: nextTree,
    parents: [parent],
  });
  await github('PATCH', 'refs/heads/main', { sha, force: false });
  return sha;
}
