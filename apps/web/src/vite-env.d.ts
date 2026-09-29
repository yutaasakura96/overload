interface ImportMetaEnv {
  /** Public by design: it ends up in the bundle (docs/12 §2). Unset, Sentry stays off. */
  readonly VITE_SENTRY_DSN?: string;
  /** Fixed at build time by vite.config.ts: production, staging, preview or development. */
  readonly VITE_SENTRY_ENVIRONMENT: string;
  /** Fixed at build time by vite.config.ts: the commit, or empty outside Vercel. */
  readonly VITE_SENTRY_RELEASE: string;
}
