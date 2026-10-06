import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/model/**/*.test.ts', 'tests/engine/**/*.test.ts', 'tests/mutations/**/*.test.ts'],
    testTimeout: 60000,
  },
});
