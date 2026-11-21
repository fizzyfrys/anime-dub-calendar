import '../docs/feed-url.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { jest } from '@jest/globals';
import { parse } from 'node-html-parser';

const { feedBaseUrl } = globalThis;
const origin = 'https://fizzyfrys.github.io';

describe('feedBaseUrl', () => {
  test.each([
    ['/anime-dub-calendar/', 'https://fizzyfrys.github.io/anime-dub-calendar/'],
    ['/anime-dub-calendar/index.html', 'https://fizzyfrys.github.io/anime-dub-calendar/'],
    ['/anime-dub-calendar', 'https://fizzyfrys.github.io/anime-dub-calendar/'],
    ['/', 'https://fizzyfrys.github.io/'],
    ['/index.html', 'https://fizzyfrys.github.io/'],
  ])('pathname %s -> %s', (pathname, expected) => {
    expect(feedBaseUrl(origin, pathname)).toBe(expected);
  });

  test('feed URL from /index.html does not nest under index.html', () => {
    const icsUrl = feedBaseUrl(origin, '/anime-dub-calendar/index.html') + 'anime-dubs.ics';
    expect(icsUrl).toBe('https://fizzyfrys.github.io/anime-dub-calendar/anime-dubs.ics');
  });
});

describe('Copy Feed URL', () => {
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
  const script = parse(html).querySelector('script:not([src])').textContent;
  const origin = 'http://192.168.1.10:8080';

  function loadPage(clipboard) {
    const elements = new Map();
    const getElementById = id => {
      if (!elements.has(id)) elements.set(id, { style: {}, setAttribute() {}, classList: { toggle() {} } });
      return elements.get(id);
    };
    const prompt = jest.fn();
    const page = {
      feedBaseUrl,
      navigator: clipboard ? { clipboard } : {},
      window: { location: { origin, pathname: '/' }, prompt },
      document: { getElementById },
      setTimeout: jest.fn(),
      fetch: () => new Promise(() => {}),
    };
    runInNewContext(script, page);
    return { page, prompt, toast: getElementById('copy-toast') };
  }

  test('shows the selected feed URL for manual copying on plain LAN HTTP', async () => {
    const { page, prompt, toast } = loadPage();
    page.selectFormat('ep-first');
    await page.copyFeedUrl();
    expect(prompt).toHaveBeenCalledWith(expect.any(String), origin + '/anime-dubs-ep-first.ics');
    expect(toast.style.display).not.toBe('block');
  });

  test('falls back to manual copying when clipboard access is denied', async () => {
    const clipboard = { writeText: jest.fn().mockRejectedValue(new Error('Permission denied')) };
    const { page, prompt, toast } = loadPage(clipboard);
    await page.copyFeedUrl();
    expect(prompt).toHaveBeenCalledWith(expect.any(String), origin + '/anime-dubs.ics');
    expect(toast.style.display).not.toBe('block');
  });

  test('copies to the clipboard when available', async () => {
    const clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
    const { page, prompt, toast } = loadPage(clipboard);
    await page.copyFeedUrl();
    expect(clipboard.writeText).toHaveBeenCalledWith(origin + '/anime-dubs.ics');
    expect(prompt).not.toHaveBeenCalled();
    expect(toast.style.display).toBe('block');
  });
});
