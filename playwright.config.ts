import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { DEFAULT_LOCAL_DATABASE_URL } from './packages/database/src/index.js';

const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const useSystemChrome = !process.env.CI && existsSync(systemChrome);
const dbUrl = process.env['DATABASE_URL'] ?? DEFAULT_LOCAL_DATABASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    ...(useSystemChrome
      ? {
          launchOptions: {
            executablePath: systemChrome
          }
        }
      : {})
  },
  webServer: [
    {
      command: 'pnpm --filter @tibia-idle/api start',
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        ...process.env,
        PORT: '3001',
        HOST: '127.0.0.1',
        DATABASE_URL: dbUrl
      }
    },
    {
      command: 'pnpm --filter @tibia-idle/web preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        ...process.env,
        API_PROXY_TARGET: 'http://127.0.0.1:3001'
      }
    }
  ]
});
