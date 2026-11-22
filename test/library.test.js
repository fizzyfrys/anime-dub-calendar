import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule } from 'node:vm';

class Element {
  children = [];
  value = '';
  textContent = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener() {}
  setAttribute() {}
  get text() {
    return [this.textContent, ...this.children.map(child => child.text ?? child)].join(' ');
  }
}

test('a synced show opens with its progress controls and episode history', async () => {
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const context = createContext({
    document: { getElementById, createElement: () => new Element(), querySelectorAll: () => [] },
    window: { addEventListener() {} },
    navigator: {},
    location: { hash: '#show/mal-12', href: 'http://localhost/library.html' },
    URL,
    fetch: async path => {
      if (path === './catalog.json') return Response.json({ catalog: [{
        id: 'mal-12', malId: 12, title: 'Synced show', platforms: ['netflix'],
        episodes: [{ episodeNumber: 1, date: '2025-01-01', platforms: [] }],
      }] });
      if (path === './api/profile') return Response.json({
        feedPath: './personal.ics?token=fixture',
        profile: { selected: [], hidden: [], platforms: [], watching: {} },
        watchlist: { remote: { selected: ['mal-12'], watching: { 'mal-12': { status: 'watching', progress: 1 } } } },
      });
      return new Response(null, { status: 404 });
    },
  });
  const module = path => new SourceTextModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { context });
  const dependencies = new Map();
  const script = module('../web/library.js');
  await script.link(path => {
    if (!dependencies.has(path)) dependencies.set(path, module('../docs/' + path));
    return dependencies.get(path);
  });
  await script.evaluate();
  await new Promise(resolve => setImmediate(resolve));
  expect(getElementById('content').text).toMatch(/Synced show.*On synced watchlist.*Save progress.*Episode history.*Watched/);
});
