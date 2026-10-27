import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: true,
    testTimeout: 15000,
    env: {
      MONOPULSE_FORCE_SIMULATION: 'true'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: {
        lines: 70,
        branches: 60
      }
    }
  }
});
