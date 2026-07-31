import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Stamped into the bundle at build time so a stale browser tab is diagnosable
  // at a glance (shown in the upload screen footer + logged on boot).
  define: {
    __BUILD_TS__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // `vite preview` does NOT read public/_headers (that's Cloudflare Pages-only
  // syntax) — mirror the same COOP/COEP headers here so a local production
  // preview (`npm run build && npm run preview`) has the same cross-origin
  // isolation as the deployed site, which multithreaded FFmpeg needs.
  preview: {
    // cors:true lets the deployed site fetch local test fixtures during
    // QA smoke tests (https page → http://localhost is allowed by Chrome).
    cors: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
  },
});
