const store = new Map();
const DEFAULT_TTL = 60_000;

export function cached(key, fetcher, ttl = DEFAULT_TTL) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data);

  return fetcher().then(data => {
    store.set(key, { data, at: Date.now() });
    return data;
  });
}

export function invalidate(key) {
  store.delete(key);
}

export function invalidatePrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function clearCache() {
  store.clear();
}
