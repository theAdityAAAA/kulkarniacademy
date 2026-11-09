import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from './vite.config.js';

// The student portal is built separately so the main website's bundle stays small
// (it doesn't need the Supabase client). Output goes to dist/portal/.
export default mergeConfig(base, defineConfig({
  build: {
    emptyOutDir: false,
    rollupOptions: { input: { portal: fileURLToPath(new URL('./portal/index.html', import.meta.url)) } },
  },
}));
