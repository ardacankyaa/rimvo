import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
