/**
 * In-memory TTL cache.
 * Entries expire lazily on read.
 */
interface CacheEntry<T> {
  value: T;
  expireAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function set<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, {
    value,
    expireAt: Date.now() + ttlMs,
  });
}

export function get<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expireAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}
