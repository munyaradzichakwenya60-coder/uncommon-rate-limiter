import { Clock } from './clock.js';
import { RateLimiterStore } from './store.js';

export interface RateLimiter {
  allow(key: string): boolean;
}

export interface SlidingWindowOptions {
  maxRequests: number;
  windowSeconds?: number;
  windowMs?: number;
  clock?: Clock;
  store?: RateLimiterStore;
}

export interface TokenBucketOptions {
  capacity: number;
  refillRatePerSecond: number;
  clock?: Clock;
}
