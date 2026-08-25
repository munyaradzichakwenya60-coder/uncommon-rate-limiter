import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/uncommon-rate-limiter/',
  test: {
    globals: true,
    environment: 'node',
  },
});
