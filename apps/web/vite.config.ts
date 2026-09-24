import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Locally the browser sees one origin, as it does behind the Vercel rewrite (docs/03 §5): the dev
// and preview servers proxy /api to the API. Playwright points it at its own API instance.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8787';
const proxy = { '/api': { target: apiTarget } };

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'Overload',
        short_name: 'Overload',
        description: 'Lift log, meal plan and bodyweight coaching.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B0D0F',
        theme_color: '#0B0D0F',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Shell only: build output is precached and nothing else. No runtime caching, and /api/* is
      // never answered from the service worker; API responses are `private, no-store` anyway
      // (docs/06, 2026-09-24).
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        // A new shell takes over at once. The plugin sets these for autoUpdate only when it injects
        // the registration itself; main.tsx registers it, so without them an update waits forever.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: Number(process.env.PREVIEW_PORT ?? 4173), strictPort: true, proxy },
});
