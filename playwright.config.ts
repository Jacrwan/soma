import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  timeout: 15_000,
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:5179', headless: true },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5179',
    url: 'http://127.0.0.1:5179',
    env: {
      VITE_SUPABASE_URL: 'https://soma-regression.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'regression-test-key',
      VITE_DEVELOPER_EMAIL: '',
    },
  },
});
