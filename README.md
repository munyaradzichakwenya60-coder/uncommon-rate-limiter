# Rate Limiter & Notification System Design

This repository contains the assessment submission for Uncommon.org, consisting of a TypeScript in-memory rate limiter (Part 1) and a notification service system design (Part 2).

## Approach, Tradeoffs & Next Steps

- **Approach:** I built an in-memory rate limiter using a sliding-window log algorithm that tracks request timestamps per client key. Expired timestamps outside the current window (`now - windowMs`) are dropped on each evaluation, preventing boundary burst exploits. The design is modular: time is injected via a `Clock` interface (`SystemClock` / `MockClock`) for deterministic testing, storage is abstracted behind a `RateLimiterStore` interface, and an interchangeable Token Bucket limiter is provided as a secondary policy.
- **Key Tradeoffs:** The sliding-window log guarantees exact rate limiting at the cost of $O(N)$ memory per active key (where $N$ is the maximum allowed requests in the window). In contrast, fixed window or token bucket algorithms use $O(1)$ memory but can permit double-rate bursts across window boundaries or require continuous token math. For a single-node in-memory engine, the precision of the sliding-window log provides the strongest correctness guarantees.
- **What I would do next with more time:** Given more time, I would build a Redis-backed implementation of `RateLimiterStore` using sorted sets (`ZADD` / `ZREMRANGEBYSCORE` / `ZCARD`) within an atomic Lua script for multi-node deployments, add a sliding-window counter approximation for high-throughput memory optimization, and expose Prometheus metrics.

## Quick Start

### Installation
```bash
npm install
```

### Running Tests
```bash
npm test
```

### Running the Live Dashboard
To start the interactive dashboard:
```bash
npm run dev
```

## Project Structure

- `src/sliding-window-limiter.ts` - Core sliding-window rate limiter
- `src/token-bucket-limiter.ts` - Token bucket rate limiter implementation
- `src/clock.ts` - System and Mock clock implementations
- `src/store.ts` - In-memory storage abstraction with idle key eviction
- `src/types.ts` - Common interfaces and configuration options
- `tests/` - Vitest test suite covering window boundaries, burst traffic, isolation, concurrency, and memory cleanup
- `SYSTEM_DESIGN.md` - Part 2 notification service architectural design document
