import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // `tsc` compiles the test files into dist/ too; don't run those copies as well.
    exclude: [...configDefaults.exclude, 'dist/**'],
    // Route tests cold-import Fastify in several workers at once, which can
    // exceed the 10s default on slower machines.
    hookTimeout: 30_000,
  },
});
