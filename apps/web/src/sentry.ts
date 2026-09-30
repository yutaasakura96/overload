import * as Sentry from '@sentry/react';
import type { RootOptions } from 'react-dom/client';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

// Sentry for the web app (docs/03 §7, docs/12 §5), on only when the build had VITE_SENTRY_DSN. The
// browser posts to Sentry directly, the one call that bypasses the API (docs/03 §1). Errors only: no
// tracing, no replay, no user, and the events are scrubbed before they leave (sentry-scrub.ts).
// Environment and release are fixed at build time (vite.config.ts).
//
// Returns createRoot's error options: React's own uncaught and recoverable errors never reach
// window.onerror. Without Sentry they are left to React's defaults.
// Still printed, as React's defaults would, for whoever has the console open.
const printed = (error: unknown) => console.error(error);

export function initSentry(): RootOptions {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return {};
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    // v11 collects every category below unless told not to.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
    // No tracesSampleRate, so no tracing, and no trace headers on the app's own requests either.
    tracePropagationTargets: [],
  });
  return {
    onUncaughtError: Sentry.reactErrorHandler(printed),
    onRecoverableError: Sentry.reactErrorHandler(printed),
  };
}
