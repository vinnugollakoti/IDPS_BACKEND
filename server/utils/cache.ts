type CacheEntry<T> = {
  data: T;
  expiry: number;
  sizeEstimate: number;
};

class BoundedServerCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxItems: number;
  private maxTotalBytes: number;
  private totalBytes = 0;
  private cleanupIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(maxItems = 15, cleanupIntervalMs = 30000, maxTotalBytes = 30 * 1024 * 1024) {
    this.maxItems = maxItems;
    this.maxTotalBytes = maxTotalBytes;
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
      this.totalBytes -= entry.sizeEstimate;
      this.cache.delete(key);
      return null;
    }
    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds: number = 30): void {
    const sizeEstimate = estimateSize(data);

    // Don't cache individual items larger than 5MB — not worth the RAM
    if (sizeEstimate > 5 * 1024 * 1024) return;

    const expiry = Date.now() + ttlSeconds * 1000;

    // Remove existing entry first
    if (this.cache.has(key)) {
      this.totalBytes -= this.cache.get(key)!.sizeEstimate;
      this.cache.delete(key);
    }

    // Evict until we're within limits
    while (this.cache.size >= this.maxItems || this.totalBytes + sizeEstimate > this.maxTotalBytes) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      this.totalBytes -= this.cache.get(oldestKey)!.sizeEstimate;
      this.cache.delete(oldestKey);
    }

    this.totalBytes += sizeEstimate;
    this.cache.set(key, { data, expiry, sizeEstimate });
  }

  invalidate(keyOrPrefix: string): void {
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (key.includes(keyOrPrefix)) {
        this.totalBytes -= entry.sizeEstimate;
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
    this.totalBytes = 0;
  }

  stats() {
    return {
      entries: this.cache.size,
      estimatedBytes: this.totalBytes,
      estimatedMB: (this.totalBytes / (1024 * 1024)).toFixed(2),
    };
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now > entry.expiry) {
        this.totalBytes -= entry.sizeEstimate;
        this.cache.delete(key);
      }
    }
  }
}

/** Rough byte-size estimate for a JS value without traversing deeply */
function estimateSize(value: unknown): number {
  try {
    // JSON.stringify is the fastest rough size estimate
    const json = JSON.stringify(value);
    // In V8, strings use ~2 bytes per char, plus object overhead is roughly 2-3x JSON size
    return json ? json.length * 2 : 128;
  } catch {
    return 1024; // fallback for circular refs
  }
}

// 15 items max, sweep every 30s, 30MB total cap
export const serverCache = new BoundedServerCache(15, 30000, 30 * 1024 * 1024);
