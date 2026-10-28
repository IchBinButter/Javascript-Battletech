import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 10000
  },
  coverage: {
    provider: 'v8',
    include: ['src/**/*.js'],
    // Data files are JSON, not code; leave them out of the denominator.
    exclude: ['src/data/**'],
    reporter: ['text-summary', 'text', 'html'],
    reportsDirectory: 'coverage',
    // A regression floor, not a target. Measured around 92/85/89/92; branch
    // coverage jitters a couple of points because the default map is randomly
    // generated, so the floor sits below the worst observed run.
    thresholds: {
      statements: 90,
      branches: 83,
      functions: 86,
      lines: 90
    }
  }
});
