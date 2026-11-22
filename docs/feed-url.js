// Directory URL that the .ics feeds are served from, derived from the page's location.
// Works whether the page is opened as ".../" , ".../index.html" or ".../repo" (no trailing slash).
export function feedBaseUrl(origin, pathname) {
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dir = lastSegment.includes('.')
    ? pathname.slice(0, pathname.length - lastSegment.length)
    : pathname.replace(/\/?$/, '/');
  return origin + dir;
}
