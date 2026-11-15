// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team

const PLAN_KEY = `marswalk-field-plan:${new URL('../../', import.meta.url).pathname}`;

export function startOffline() {
  const url = new URL(location.href);
  if (url.search === '?launch=1') {
    let savedSearch;
    try { savedSearch = localStorage.getItem(PLAN_KEY); } catch { /* Storage may be disabled. */ }
    url.search = savedSearch ?? '';
    history.replaceState(history.state, '', url);
  }

  const { serviceWorker } = navigator;
  if (!serviceWorker) return;

  const banner = document.getElementById('offline-banner');
  const updateBanner = () => {
    const offline = !navigator.onLine && Boolean(serviceWorker.controller);
    banner.hidden = !offline;
    document.body.classList.toggle('has-offline-plan', offline);
  };
  window.addEventListener('online', updateBanner);
  window.addEventListener('offline', updateBanner);
  serviceWorker.addEventListener('controllerchange', updateBanner);
  updateBanner();

  const firstVisit = !serviceWorker.controller;
  serviceWorker.register(new URL('../../sw.js', import.meta.url), { updateViaCache: 'none' }).then(async () => {
    if (!firstVisit || !globalThis.PerformanceObserver) return;
    const { active } = await serviceWorker.ready;
    const observer = new PerformanceObserver((list) => {
      const urls = [...new Set(list.getEntries().map(({ name }) => name).filter((name) =>
        name.startsWith('https://unpkg.com/') || name.startsWith('https://mars.nasa.gov/')))];
      if (urls.length) active.postMessage({ type: 'warm-external', urls });
    });
    observer.observe({ type: 'resource', buffered: true });
  }).catch(() => {}); // Offline support is optional on unsupported or restricted origins.
}

export function rememberFieldPlan({ url, dataset }) {
  const params = new URLSearchParams({ data: dataset });
  for (const name of ['stops', 'route', 'cond', 'dust', 'solar', 'kit']) {
    if (url.searchParams.has(name)) params.set(name, url.searchParams.get(name));
  }
  try { localStorage.setItem(PLAN_KEY, `?${params}`); } catch { /* Storage may be disabled. */ }
}
