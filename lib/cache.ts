interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const cacheStore = new Map<string, CacheEntry<any>>()

// Clean expired cache items periodically every 60 seconds
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of cacheStore.entries()) {
      if (now > entry.expiresAt) {
        cacheStore.delete(key)
      }
    }
  }, 60 * 1000).unref?.()
}

/**
 * Retrieve an item from the cache if not expired
 */
export function cacheGet<T>(key: string): T | null {
  const entry = cacheStore.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cacheStore.delete(key)
    return null
  }
  return entry.data as T
}

/**
 * Store an item in the cache with a specified TTL in seconds
 */
export function cacheSet<T>(key: string, data: T, ttlSeconds: number): void {
  cacheStore.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  })
}

/**
 * Helper to fetch with cache (stale-while-revalidate or cache-first)
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<{ data: T; cached: boolean }> {
  const cached = cacheGet<T>(key)
  if (cached !== null) {
    return { data: cached, cached: true }
  }
  const data = await fetcher()
  cacheSet(key, data, ttlSeconds)
  return { data, cached: false }
}

/**
 * Clear the cache or keys matching a prefix
 */
export function cacheClear(prefix?: string): void {
  if (!prefix) {
    cacheStore.clear()
    return
  }
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key)
    }
  }
}
