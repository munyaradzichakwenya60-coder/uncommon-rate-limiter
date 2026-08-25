import { Clock, SystemClock } from './clock.js';
import { RateLimiter, TokenBucketOptions } from './types.js';

interface BucketState {
  tokens: number;
  lastRefillTime: number;
}

export class TokenBucketRateLimiter implements RateLimiter {
  private readonly capacity: number;
  private readonly refillRatePerSecond: number;
  private readonly clock: Clock;
  private readonly buckets = new Map<string, BucketState>();

  constructor(options: TokenBucketOptions) {
    if (options.capacity <= 0) {
      throw new Error('capacity must be greater than 0');
    }
    if (options.refillRatePerSecond <= 0) {
      throw new Error('refillRatePerSecond must be greater than 0');
    }

    this.capacity = options.capacity;
    this.refillRatePerSecond = options.refillRatePerSecond;
    this.clock = options.clock ?? new SystemClock();
  }

  allow(key: string): boolean {
    return this.consume(key, 1);
  }

  consume(key: string, tokensToConsume: number = 1): boolean {
    if (!key || typeof key !== 'string') {
      throw new Error('A valid string key is required');
    }
    if (tokensToConsume <= 0) {
      throw new Error('tokensToConsume must be greater than 0');
    }

    const now = this.clock.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefillTime: now,
      };
      this.buckets.set(key, bucket);
    } else {
      const elapsedSeconds = Math.max(0, (now - bucket.lastRefillTime) / 1000);
      const tokensToAdd = elapsedSeconds * this.refillRatePerSecond;

      bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefillTime = now;
    }

    if (bucket.tokens >= tokensToConsume) {
      bucket.tokens -= tokensToConsume;
      return true;
    }

    return false;
  }

  cleanup(maxIdleMs: number = 60000): number {
    const now = this.clock.now();
    let purged = 0;

    for (const [key, state] of this.buckets.entries()) {
      if (now - state.lastRefillTime > maxIdleMs) {
        this.buckets.delete(key);
        purged++;
      }
    }

    return purged;
  }

  getAvailableTokens(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return this.capacity;

    const now = this.clock.now();
    const elapsedSeconds = Math.max(0, (now - bucket.lastRefillTime) / 1000);
    return Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillRatePerSecond);
  }
}
