import { describe, it, expect, beforeEach } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/sliding-window-limiter.js';
import { TokenBucketRateLimiter } from '../src/token-bucket-limiter.js';
import { MockClock } from '../src/clock.js';
import { InMemoryStore } from '../src/store.js';

describe('Memory Cleanup & Leak Prevention', () => {
  let clock: MockClock;

  beforeEach(() => {
    clock = new MockClock(1000);
  });

  describe('SlidingWindowRateLimiter Cleanup', () => {
    it('purges idle keys while preserving active keys', () => {
      const store = new InMemoryStore();
      const limiter = new SlidingWindowRateLimiter({
        maxRequests: 5,
        windowSeconds: 10,
        clock,
        store,
      });

      limiter.allow('user_a');
      limiter.allow('user_b');

      expect(store.size()).toBe(2);

      clock.advanceSeconds(15);

      limiter.allow('user_a');

      clock.advanceSeconds(10);

      const purged = limiter.cleanup(20000);
      expect(purged).toBe(1);
      expect(store.size()).toBe(1);
      expect(store.has('user_a')).toBe(true);
      expect(store.has('user_b')).toBe(false);
    });
  });

  describe('TokenBucketRateLimiter Cleanup', () => {
    it('cleans up inactive buckets over time', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 5,
        refillRatePerSecond: 1,
        clock,
      });

      limiter.allow('device_1');
      limiter.allow('device_2');

      clock.advanceSeconds(70);

      limiter.allow('device_1');

      const purged = limiter.cleanup(60000);
      expect(purged).toBe(1);
    });
  });
});
