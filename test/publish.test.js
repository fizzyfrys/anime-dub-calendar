import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import { prepareCalendarPublish } from '../src/publish.js';

const repository = 'test-owner/calendar';
const files = ['anime-dubs.ics', 'anime-dubs-ep-first.ics', 'schedule.json', 'state.json'];
const contents = ['BEGIN:VCALENDAR\r\n', 'END:VCALENDAR\r\n', '{"shows":[]}', '{"history":{}}'];
const response = (body, status = 200) => Response.json(body, { status });
const api = `https://api.github.com/repos/${repository}/`;
const publishedState = '{"history":{"previously-aired":{"4":"2026-07-23"}}}';
let data;
let tokenFile;
let request;

beforeEach(async () => {
  data = await mkdtemp(join(tmpdir(), 'calendar-publish-'));
  tokenFile = join(data, 'token');
  await Promise.all(files.map((file, index) => writeFile(join(data, file), contents[index])));
  await writeFile(tokenFile, 'test-token\n');
  request = jest.fn()
    .mockResolvedValueOnce(response({ object: { sha: 'head' } }))
    .mockResolvedValueOnce(response({ tree: { sha: 'base' } }));
});

afterEach(async () => { await rm(data, { recursive: true, force: true }); });

const prepare = () => prepareCalendarPublish({ repository, tokenFile, request });

test('uses history from the same commit that the four generated files update', async () => {
  request.mockResolvedValueOnce(new Response(publishedState))
    .mockResolvedValueOnce(response({ sha: 'generated' }, 201))
    .mockResolvedValueOnce(response({ sha: 'commit' }, 201))
    .mockResolvedValueOnce(response({ object: { sha: 'commit' } }));

  const sync = await prepare();
  expect(sync.state).toBe(publishedState);
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[2][1].headers.Accept).toBe('application/vnd.github.raw+json');
  await expect(sync.publish(data, files)).resolves.toBe('commit');
  expect(request.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
    ['GET', api + 'git/ref/heads/main'],
    ['GET', api + 'git/commits/head'],
    ['GET', api + 'contents/docs/state.json?ref=head'],
    ['POST', api + 'git/trees'],
    ['POST', api + 'git/commits'],
    ['PATCH', api + 'git/refs/heads/main'],
  ]);
  expect(JSON.parse(request.mock.calls[3][1].body)).toEqual({
    base_tree: 'base',
    tree: files.map((file, index) => ({
      path: `docs/${file}`, mode: '100644', type: 'blob', content: contents[index],
    })),
  });
  expect(JSON.parse(request.mock.calls[4][1].body)).toMatchObject({ tree: 'generated', parents: ['head'] });
  expect(JSON.parse(request.mock.calls[5][1].body)).toEqual({ sha: 'commit', force: false });
  expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
});

test('does not create a commit if the generated files are unchanged', async () => {
  request.mockResolvedValueOnce(new Response(publishedState))
    .mockResolvedValueOnce(response({ sha: 'base' }, 201));
  const sync = await prepare();
  await expect(sync.publish(data, files)).resolves.toBeNull();
  expect(request).toHaveBeenCalledTimes(4);
});

test('reports a concurrent branch update without retrying or forcing it', async () => {
  request.mockResolvedValueOnce(new Response(publishedState))
    .mockResolvedValueOnce(response({ sha: 'generated' }, 201))
    .mockResolvedValueOnce(response({ sha: 'commit' }, 201))
    .mockResolvedValueOnce(response({}, 422));
  const sync = await prepare();
  await expect(sync.publish(data, files)).rejects.toThrow('GitHub PATCH git/refs/heads/main returned HTTP 422');
  expect(request).toHaveBeenCalledTimes(6);
});

test('cannot start a publish when the existing history could not be read', async () => {
  request.mockResolvedValueOnce(response({}, 404));
  await expect(prepare()).rejects.toThrow('GitHub GET contents/docs/state.json?ref=head returned HTTP 404');
  expect(request).toHaveBeenCalledTimes(3);
});

test('rejects missing credentials before calling GitHub', async () => {
  await writeFile(tokenFile, '\n');
  await expect(prepare()).rejects.toThrow('GitHub publish token file is empty');
  expect(request).not.toHaveBeenCalled();
});
