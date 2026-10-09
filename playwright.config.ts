import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/__tests__',
  testMatch: '*.e2e.spec.ts',
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
});
