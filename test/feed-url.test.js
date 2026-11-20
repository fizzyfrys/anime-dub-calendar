import '../docs/feed-url.js';

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
