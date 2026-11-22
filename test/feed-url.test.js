import { feedBaseUrl } from '../docs/feed-url.js';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule } from 'node:vm';
import { jest } from '@jest/globals';

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
  const origin = 'http://192.168.1.10:8080';

  async function loadPage(clipboard) {
    const elements = new Map();
    const getElementById = id => {
      if (!elements.has(id)) elements.set(id, { addEventListener(type, fn) { this[type] = fn; } });
      return elements.get(id);
    };
    const prompt = jest.fn();
    const context = createContext({
      navigator: clipboard ? { clipboard } : {},
      window: { prompt },
      location: { origin, pathname: '/' },
      document: { getElementById },
      fetch: () => new Promise(() => {}),
    });
    const module = path => new SourceTextModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { context });
    const script = module('../docs/dashboard.js');
    await script.link(path => module('../docs/' + path));
    await script.evaluate();
    return {
      format: getElementById('format'), copy: getElementById('copy-btn').click,
      prompt, toast: getElementById('copy-toast'),
    };
  }

  test('shows the selected feed URL for manual copying on plain LAN HTTP', async () => {
    const { format, copy, prompt, toast } = await loadPage();
    format.value = 'ep-first';
    format.change();
    await copy();
    expect(prompt).toHaveBeenCalledWith(expect.any(String), origin + '/anime-dubs-ep-first.ics');
    expect(toast.textContent).toBeUndefined();
  });

  test('falls back to manual copying when clipboard access is denied', async () => {
    const clipboard = { writeText: jest.fn().mockRejectedValue(new Error('Permission denied')) };
    const { copy, prompt, toast } = await loadPage(clipboard);
    await copy();
    expect(prompt).toHaveBeenCalledWith(expect.any(String), origin + '/anime-dubs.ics');
    expect(toast.textContent).toBeUndefined();
  });

  test('copies to the clipboard when available', async () => {
    const clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
    const { copy, prompt, toast } = await loadPage(clipboard);
    await copy();
    expect(clipboard.writeText).toHaveBeenCalledWith(origin + '/anime-dubs.ics');
    expect(prompt).not.toHaveBeenCalled();
    expect(toast.textContent).toBe('Feed URL copied.');
  });
});
