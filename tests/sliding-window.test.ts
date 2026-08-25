import { describe, it, expect, beforeEach } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/sliding-window-limiter.js';
import { MockClock } from '../src/clock.js';

describe('SlidingWindowRateLimiter', () => {
  let clock: MockClock;

  beforeEach(() => {
    clock = new MockClock(1000);
  });

  describe('Core Behavior & First Request', () => {
    it('allows the very first request for a key', () => {
      const limiter = new SlidingWindowRateLimiter({
        maxRequests: 3,
        windowSeconds: 10,
        clock,
      });

      expect(limiter.allow('client-1')).toBe(true);
    });

    it('allows requests up to maxRequests limit', () => {
      const limiter = new SlidingWindowRateLimiter({
        maxRequests: 3,
        windowSeconds: 10,
        clock,
      });

      expect(limiter.allow('user_123')).toBe(true);
      expect(limiter.allow('user_123')).toBe(true);
      expect(limiter.allow('user_123')).toBe(true);
      expect(limiter.allow('user_123')).toBe(false);
    });
  });

  describe('Window Boundary & Expiry', () => {
    it('allows new requests once the sliding window moves past old timestamps', () => {
      const limiter = new SlidingWindowRateLimiter({
        maxRequests: 2,
        windowSeconds: 10,
        clock,
      });

      expect(limiter.allow('client-a')).toBe(true);

      clock.advanceSeconds(3);
      expect(limiter.allow('client-a')).toBe(true);

      clock.advanceSeconds(1);
      expect(limiter.allow('client-a')).toBe(false);

      clock.setTime(11001);
      expect(limiter.allow('client-a')).toBe(true);

      expect(limiter.allow('client-a')).toBe(false);

      clock.setTime(14001);
      expect(limiter.allow('client-a')).toBe(true);
    });

    it('correctly handles fractional sliding sub-windows', () => {
      const limiter = new SlidingWindowRateLimiter({
        maxRequests: 5,
        windowMs: 5000,
        clock,
      });

      for (let i = 0; i < 5; i++) {
        expect(limiter.allow('sensor-1')).toBe(true);
        clock.advance(1000);
      }

      expect(limiter.allow('sensor-1')).toBe(true);
    });
  });

  describe('Key Isolation', () => {
    it('limits different keys independently', () => {
      const limiter = new SlidingWindowRateLimiter({
        maxRequests: 2,
        windowSeconds: 5,
        clock,
      });

      expect(limiter.allow('client-1')).toBe(true);
      expect(limiter.allow('client-1')).toBe(true);
      expect(limiter.allow('client-1')).toBe(false);

      expect(limiter.allow('client-2')).toBe(true);
      expect(limiter.allow('client-2')).toBe(true);
      expect(limiter.allow('client-2')).toBe(false);

      expect(limiter.allow('client-3')).toBe(true);
    });
  });

  describe('Burst Traffic Handling', () => {
    it('handles instantaneous bursts cleanly', () => {
      const limiter = new SlidingWindowRateLimiter({
        maxRequests: 100,
        windowSeconds: 60,
        clock,
      });

      for (let i = 0; i < 100; i++) {
        expect(limiter.allow('api-client')).toBe(true);
      }

      expect(limiter.allow('api-client')).toBe(false);
    });
  });

  describe('Validation & Edge Cases', () => {
    it('throws when maxRequests is invalid', () => {
      expect(() => new SlidingWindowRateLimiter({ maxRequests: 0, windowSeconds: 5 })).toThrow();
      expect(() => new SlidingWindowRateLimiter({ maxRequests: -2, windowSeconds: 5 })).toThrow();
      expect(() => new SlidingWindowRateLimiter({ maxRequests: 2.5, windowSeconds: 5 })).toThrow();
    });

    it('throws when window duration is invalid', () => {
      expect(() => new SlidingWindowRateLimiter({ maxRequests: 5, windowSeconds: 0 })).toThrow();
      expect(() => new SlidingWindowRateLimiter({ maxRequests: 5, windowMs: -100 })).toThrow();
      expect(() => new SlidingWindowRateLimiter({ maxRequests: 5 })).toThrow();
    });

    it('throws when key is empty or invalid', () => {
      const limiter = new SlidingWindowRateLimiter({ maxRequests: 5, windowSeconds: 10 });
      expect(() => limiter.allow('')).toThrow();
      expect(() => limiter.allow(null as unknown as string)).toThrow();
    });
  });
});
