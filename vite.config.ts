import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  optimizeDeps: {
    entries: ['index.html'],
    include: ['@soundtouchjs/core', '@soundtouchjs/interpolation-strategy-lanczos', '@breezystack/lamejs'],
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
});
