type CacheEntry<T> = {
  data: T;
  expiry: number;
};

class BoundedServerCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxItems: number;
  private cleanupIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(maxItems = 50, cleanupIntervalMs = 60000) {
    this.maxItems = maxItems;
    this.cleanupIntervalMs = cleanupIntervalMs;

    // Periodically sweep expired entries to free RAM
    if (typeof setInterval !== 'undefined') {
      this.timer = setInterval(() => this.sweepExpired(), this.cleanupIntervalMs);
      if (this.timer.unref) {
        this.timer.unref(); // Don't block node process exit
      }
    }
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds: number = 60): void {
    const expiry = Date.now() + ttlSeconds * 1000;
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxItems) {
      // Evict oldest entry (LRU)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { data, expiry });
  }

  invalidate(keyOrPrefix: string): void {
    for (const key of Array.from(this.cache.keys())) {
      if (key.includes(keyOrPrefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

export const serverCache = new BoundedServerCache(50, 60000);
