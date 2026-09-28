import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Locally the browser sees one origin, as it does behind the Vercel rewrite (docs/03 §5): the dev
// and preview servers proxy /api to the API. Playwright points it at its own API instance.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8787';
const proxy = { '/api': { target: apiTarget } };

// Sentry's environment, as the API names it (apps/api/src/lib/error-report.ts): develop's preview is
// staging, any other preview a pull request's. Vercel sets both variables at build time.
function sentryEnvironment(env: NodeJS.ProcessEnv): string {
  if (env.VERCEL_ENV === 'production') return 'production';
  if (env.VERCEL_ENV === 'preview') {
    return env.VERCEL_GIT_COMMIT_REF === 'develop' ? 'staging' : 'preview';
  }
  return 'development';
}

// Source maps go to Sentry and nowhere else: made only when a build can upload them, uploaded, then
// deleted before the output is deployed or precached (docs/12 §2). The org comes from the org token.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || undefined;

export default defineConfig({
  define: {
    'import.meta.env.VITE_SENTRY_ENVIRONMENT': JSON.stringify(sentryEnvironment(process.env)),
    'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ''),
  },
  build: { sourcemap: sentryAuthToken === undefined ? false : 'hidden' },
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
    sentryAuthToken !== undefined &&
      sentryVitePlugin({
        authToken: sentryAuthToken,
        project: 'overload-web',
        release: { name: process.env.VERCEL_GIT_COMMIT_SHA },
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        telemetry: false,
      }),
  ],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: Number(process.env.PREVIEW_PORT ?? 4173), strictPort: true, proxy },
});
