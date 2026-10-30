import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@tibia-idle/i18n': resolve(import.meta.dirname, '../../packages/i18n/src/index.ts'),
      '@tibia-idle/contracts': resolve(import.meta.dirname, '../../packages/contracts/src/index.ts')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});
