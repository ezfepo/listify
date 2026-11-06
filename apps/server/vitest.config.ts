import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // `tsc` compiles the test files into dist/ too; don't run those copies as well.
    exclude: [...configDefaults.exclude, 'dist/**'],
    // Route tests cold-import Fastify in several workers at once, which can
    // exceed the 10s default on slower machines.
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // Count every source file, including ones no test imports yet.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/index.ts'],
      reporter: ['text-summary', 'text'],
      // CI gate (npm run coverage): just below the measured values, so regressions fail.
      thresholds: { statements: 95, branches: 87, functions: 95, lines: 96 },
    },
  },
});
