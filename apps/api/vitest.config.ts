import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Files share one database. Rolled-back transactions keep them apart, but a row lock held by one
    // file's open transaction would stall another, so files run one at a time.
    fileParallelism: false,
  },
});
