import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/scenarios/**/*.test.ts'],
    // Each scenario hits real network + Claude API — allow 3 min per test/hook
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Run sequentially — each audit uses significant CPU/memory (headless Chromium)
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    reporters: ['verbose'],
  },
})
