import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const useSystemChrome = !process.env.CI && existsSync(systemChrome);

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
  webServer: {
    command: 'pnpm --filter @tibia-idle/web preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});
