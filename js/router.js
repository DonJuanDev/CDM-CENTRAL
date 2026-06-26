const DEFAULT_VIEW = 'dashboard';
const STORAGE_KEY = 'cdm-last-view';

export function resolveView(viewId, navItems) {
  if (viewId && navItems.some(n => n.id === viewId)) return viewId;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && navItems.some(n => n.id === saved)) return saved;
  return DEFAULT_VIEW;
}

export function readViewFromLocation(navItems) {
  const hash = window.location.hash.replace(/^#\/?/, '').trim();
  const viewId = hash.split('?')[0].split('/')[0];
  return resolveView(viewId, navItems);
}

export function parseHashQuery() {
  const hash = window.location.hash.replace(/^#\/?/, '').trim();
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return {};
  return Object.fromEntries(new URLSearchParams(hash.slice(qIdx + 1)));
}

export function writeViewHash(view, query = {}, { replace = false } = {}) {
  localStorage.setItem(STORAGE_KEY, view);
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v != null && v !== '') params.set(k, v);
  });
  const qs = params.toString();
  const target = `#/${view}${qs ? `?${qs}` : ''}`;
  if (window.location.hash === target) return;
  const url = `${window.location.pathname}${target}`;
  if (replace) history.replaceState({ view, query }, '', url);
  else history.pushState({ view, query }, '', url);
}

export function writeViewToLocation(view, { replace = false } = {}) {
  localStorage.setItem(STORAGE_KEY, view);
  const target = `#/${view}`;
  if (window.location.hash === target) return;
  const url = `${window.location.pathname}${target}`;
  if (replace) history.replaceState({ view }, '', url);
  else history.pushState({ view }, '', url);
}

export function bindRouter(onViewChange) {
  let busy = false;

  async function handleRoute() {
    if (busy) return;
    busy = true;
    try {
      await onViewChange(readViewFromLocation);
    } finally {
      busy = false;
    }
  }

  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('popstate', handleRoute);
}
