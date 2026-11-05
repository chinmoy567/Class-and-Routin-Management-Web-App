import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.js'],
    setupFiles: ['./test/setup.js'],
    include: [
      'src/**/__tests__/**/*.test.js',
      'test/**/*.test.js',
      'scripts/**/__tests__/*.test.js',
    ],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Half the cores: the FRV-10 timing check (spec 13) must not compete with every file at once.
    fileParallelism: true,
    poolOptions: { forks: { minForks: 1, maxForks: 6 } },
  },
});
