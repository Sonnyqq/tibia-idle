import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@tibia-idle/i18n': resolve(import.meta.dirname, 'packages/i18n/src/index.ts'),
      '@tibia-idle/contracts': resolve(import.meta.dirname, 'packages/contracts/src/index.ts'),
      '@tibia-idle/domain': resolve(import.meta.dirname, 'packages/domain/src/index.ts'),
      '@tibia-idle/database': resolve(import.meta.dirname, 'packages/database/src/index.ts'),
      '@tibia-idle/api': resolve(import.meta.dirname, 'apps/api/src/index.ts'),
      '@tibia-idle/web': resolve(import.meta.dirname, 'apps/web/src')
    }
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: false
  }
});
