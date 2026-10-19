import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// En desarrollo, /api se reenvía al backend para no tener CORS ni URLs absolutas.
const backend = process.env['VITE_BACKEND_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': backend } },
  preview: { port: 5173, proxy: { '/api': backend } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
