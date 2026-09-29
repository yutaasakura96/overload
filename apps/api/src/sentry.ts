import * as Sentry from '@sentry/hono/node';
import { sentryEnvironment, type ReportError } from './lib/error-report.js';
import { scrubEvent } from './lib/sentry-scrub.js';

// Sentry for the API (docs/03 §7, docs/12 §5), loaded by index.ts only when SENTRY_DSN is set.
// Errors only: no tracing, no breadcrumbs, no user, no request data. Events are captured by the app's
// onError, the one place a 500 is made, rather than by the SDK's Hono middleware, so that onError can
// wait for the send: a Vercel function may be frozen once its response is returned (docs/06,
// 2026-09-19).
const FLUSH_TIMEOUT_MS = 2000;

/** `transport` is for tests, which read the events instead of sending them. */
export function initSentry(
  env: Record<string, string | undefined>,
  { transport }: Pick<Sentry.NodeOptions, 'transport'> = {},
): ReportError {
  Sentry.init({
    transport,
    dsn: env.SENTRY_DSN,
    environment: sentryEnvironment(env),
    release: env.VERCEL_GIT_COMMIT_SHA,
    // v11 collects every category below unless told not to. Source lines around frames stay: code only.
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
    maxBreadcrumbs: 0,
    beforeSend: scrubEvent,
    // No tracesSampleRate, so no tracing, and no trace headers on calls to Google or Neon either.
    tracePropagationTargets: [],
  });

  return async (error, { requestId, method, route }) => {
    try {
      Sentry.withScope((scope) => {
        scope.setTags({ requestId, method, route });
        Sentry.captureException(error);
      });
      await Sentry.flush(FLUSH_TIMEOUT_MS);
    } catch {
      // Reporting never turns one failure into two: the problem response still goes out.
    }
  };
}
