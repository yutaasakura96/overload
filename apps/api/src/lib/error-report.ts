/** Where an unexpected failure (a 500) is sent besides the log: Sentry when it is configured. */
export type ReportError = (error: Error, context: ErrorContext) => Promise<void>;

/** Ids and the route pattern only, never a path with its ids filled in or a query (docs/03 §7). */
export type ErrorContext = { requestId: string; method: string; route: string };

/**
 * The Sentry environment for a deployment (docs/12 §1, §5): develop's preview is staging, any other
 * preview is a pull request's. Alerts filter on `production`.
 */
export function sentryEnvironment(env: Record<string, string | undefined>): string {
  if (env.VERCEL_ENV === 'production') return 'production';
  if (env.VERCEL_ENV === 'preview') {
    return env.VERCEL_GIT_COMMIT_REF === 'develop' ? 'staging' : 'preview';
  }
  return 'development';
}
