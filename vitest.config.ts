import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // Cover ALL production source — previously only `src/lib/soar/**` was
      // covered, leaving the engine, auth, crypto, audit, and all API
      // routes unmeasured. The new scope covers everything in src/lib and
      // src/app/api (the actual production code paths).
      include: [
        'src/lib/**/*.ts',
        'src/app/api/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        'src/lib/soar/nodes/bootstrap.ts', // pure side-effect wiring
        'src/lib/soar/repositories/mongo-client.ts', // requires live MongoDB
      ],
      thresholds: {
        // Raised from 60% → 70% as a first step. Goal: 80%+ by next quarter.
        // The security-critical modules (crypto, ssrf-guard, sanitizer,
        // rate-limit) already exceed 90%; the laggards are API routes
        // (which need integration tests) and node executors (which need
        // fixture-based tests).
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
    setupFiles: ['./tests/setup.ts'],
    pool: 'threads',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
