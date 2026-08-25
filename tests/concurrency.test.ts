import { describe, it, expect } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/sliding-window-limiter.js';
import { TokenBucketRateLimiter } from '../src/token-bucket-limiter.js';

describe('Concurrency & High Throughput', () => {
  it('correctly bounds allowed requests under concurrent asynchronous calls', async () => {
    const limiter = new SlidingWindowRateLimiter({
      maxRequests: 50,
      windowSeconds: 5,
    });

    const key = 'concurrent_client';
    const totalAttempts = 150;

    const results = await Promise.all(
      Array.from({ length: totalAttempts }, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return limiter.allow(key);
      })
    );

    const allowedCount = results.filter(Boolean).length;
    const throttledCount = results.filter((res) => !res).length;

    expect(allowedCount).toBe(50);
    expect(throttledCount).toBe(100);
  });

  it('maintains strict isolation under concurrent multi-client load', async () => {
    const limiter = new SlidingWindowRateLimiter({
      maxRequests: 10,
      windowSeconds: 5,
    });

    const clientCount = 5;
    const requestsPerClient = 20;

    const tasks: Promise<{ client: string; allowed: boolean }>[] = [];

    for (let c = 0; c < clientCount; c++) {
      const clientId = `client_${c}`;
      for (let r = 0; r < requestsPerClient; r++) {
        tasks.push(
          (async () => {
            await new Promise((resolve) => setImmediate(resolve));
            return { client: clientId, allowed: limiter.allow(clientId) };
          })()
        );
      }
    }

    const results = await Promise.all(tasks);

    for (let c = 0; c < clientCount; c++) {
      const clientId = `client_${c}`;
      const clientResults = results.filter((r) => r.client === clientId);
      const allowed = clientResults.filter((r) => r.allowed).length;
      const throttled = clientResults.filter((r) => !r.allowed).length;

      expect(allowed).toBe(10);
      expect(throttled).toBe(10);
    }
  });

  it('handles token bucket under concurrent load', async () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 25,
      refillRatePerSecond: 1,
    });

    const totalRequests = 60;
    const results = await Promise.all(
      Array.from({ length: totalRequests }, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return limiter.allow('concurrent_token_client');
      })
    );

    const allowed = results.filter(Boolean).length;
    expect(allowed).toBe(25);
  });
});
