import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBucketRateLimiter } from '../src/token-bucket-limiter.js';
import { MockClock } from '../src/clock.js';

describe('TokenBucketRateLimiter', () => {
  let clock: MockClock;

  beforeEach(() => {
    clock = new MockClock(0);
  });

  it('allows requests up to initial capacity', () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 3,
      refillRatePerSecond: 1,
      clock,
    });

    expect(limiter.allow('client-1')).toBe(true);
    expect(limiter.allow('client-1')).toBe(true);
    expect(limiter.allow('client-1')).toBe(true);
    expect(limiter.allow('client-1')).toBe(false);
  });

  it('refills tokens over time at the specified rate', () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 2,
      refillRatePerSecond: 1,
      clock,
    });

    expect(limiter.allow('client-a')).toBe(true);
    expect(limiter.allow('client-a')).toBe(true);
    expect(limiter.allow('client-a')).toBe(false);

    clock.advanceSeconds(1);
    expect(limiter.allow('client-a')).toBe(true);
    expect(limiter.allow('client-a')).toBe(false);

    clock.advanceSeconds(3);
    expect(limiter.allow('client-a')).toBe(true);
    expect(limiter.allow('client-a')).toBe(true);
    expect(limiter.allow('client-a')).toBe(false);
  });

  it('supports consuming multiple tokens', () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 10,
      refillRatePerSecond: 2,
      clock,
    });

    expect(limiter.consume('batch-job', 5)).toBe(true);
    expect(limiter.consume('batch-job', 5)).toBe(true);
    expect(limiter.consume('batch-job', 1)).toBe(false);

    clock.advanceSeconds(2);
    expect(limiter.consume('batch-job', 4)).toBe(true);
    expect(limiter.consume('batch-job', 1)).toBe(false);
  });

  it('isolates buckets across different keys', () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 2,
      refillRatePerSecond: 1,
      clock,
    });

    expect(limiter.allow('key-1')).toBe(true);
    expect(limiter.allow('key-1')).toBe(true);
    expect(limiter.allow('key-1')).toBe(false);

    expect(limiter.allow('key-2')).toBe(true);
    expect(limiter.allow('key-2')).toBe(true);
  });

  it('validates configuration parameters', () => {
    expect(() => new TokenBucketRateLimiter({ capacity: 0, refillRatePerSecond: 1 })).toThrow();
    expect(() => new TokenBucketRateLimiter({ capacity: 5, refillRatePerSecond: 0 })).toThrow();
    expect(() => new TokenBucketRateLimiter({ capacity: -5, refillRatePerSecond: 1 })).toThrow();
  });
});
