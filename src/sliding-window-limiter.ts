import { Clock, SystemClock } from './clock.js';
import { InMemoryStore, RateLimiterStore } from './store.js';
import { RateLimiter, SlidingWindowOptions } from './types.js';

export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly clock: Clock;
  private readonly store: RateLimiterStore;

  constructor(options: SlidingWindowOptions) {
    if (!Number.isInteger(options.maxRequests) || options.maxRequests <= 0) {
      throw new Error('maxRequests must be a positive integer');
    }

    const windowMs =
      options.windowMs ??
      (options.windowSeconds !== undefined ? options.windowSeconds * 1000 : undefined);

    if (windowMs === undefined || windowMs <= 0) {
      throw new Error('Window duration must be a positive number');
    }

    this.maxRequests = options.maxRequests;
    this.windowMs = windowMs;
    this.clock = options.clock ?? new SystemClock();
    this.store = options.store ?? new InMemoryStore();
  }

  allow(key: string): boolean {
    if (!key || typeof key !== 'string') {
      throw new Error('A valid string key is required');
    }

    const now = this.clock.now();
    const windowStart = now - this.windowMs;

    const existingTimestamps = this.store.get(key) ?? [];
    const validTimestamps = existingTimestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= this.maxRequests) {
      this.store.set(key, validTimestamps, now);
      return false;
    }

    validTimestamps.push(now);
    this.store.set(key, validTimestamps, now);
    return true;
  }

  cleanup(maxIdleMs?: number): number {
    const idleThreshold = maxIdleMs ?? this.windowMs * 2;
    return this.store.cleanup(idleThreshold, this.clock.now());
  }

  getStore(): RateLimiterStore {
    return this.store;
  }
}
