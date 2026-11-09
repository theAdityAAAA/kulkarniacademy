import { defineConfig } from 'vite';

// During local development, send /api requests to the backend (cd backend && npm run dev).
// Set API_URL to point somewhere else, e.g. API_URL=http://127.0.0.1:3011
const proxy = { '/api': process.env.API_URL || 'http://127.0.0.1:3001' };

export default defineConfig({
  server: { proxy },
  preview: { proxy },
});
