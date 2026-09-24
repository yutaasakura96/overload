import { OpenAPIHono } from '@hono/zod-openapi';
import type { Hook } from '@hono/zod-openapi';
import type { Context, Next } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import type { AppEnv, RouteDeps } from './app-env';
import type { Auth } from './auth/auth';
import { problem, type ProblemCode } from './lib/problem';
import { exerciseRoutes } from './routes/exercises';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';

export type AppDeps = RouteDeps & {
  auth: Auth;
  /** One JSON line per request (docs/03 §7). Tests pass a no-op. */
  log?: (line: string) => void;
};

const AUTH_PREFIX = '/api/auth/';

// Paths that answer without a session. Everything else under /api/ needs one (docs/08 §5), so a
// route added later is closed until it is deliberately opened here.
const isPublic = (path: string) => path.startsWith(AUTH_PREFIX) || path === '/api/health';

// Hono's csrf() guards our own cookie routes. Better Auth checks Origin on its own, and the
// ingest and cron routes take no cookie (docs/08 §2).
const isCsrfExempt = (path: string) =>
  path.startsWith(AUTH_PREFIX) || path.startsWith('/api/ingest/') || path.startsWith('/api/cron/');

const validationHook: Hook<unknown, AppEnv, string, unknown> = (result, c) => {
  if (result.success) return undefined;
  const errors = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  if (result.target === 'json' || result.target === 'form') {
    return problem(c, 'validation_failed', { errors });
  }
  // A query, path or header parameter of the wrong type (docs/07 §1.3).
  return problem(c, 'bad_request', {
    detail: `Invalid parameter: ${errors[0]?.path ?? 'unknown'}`,
  });
};

export function createApp({ auth, config, db, log = console.log }: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app.use('*', requestId({ generator: () => `req_${crypto.randomUUID().replaceAll('-', '')}` }));

  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    // Every response, Better Auth's included (docs/07 §1.1). A rewrite honours it (docs/03 §5).
    c.res.headers.set('Cache-Control', 'private, no-store');
    // Ids and codes only: never a body, a token or an email (docs/03 §7).
    log(
      JSON.stringify({
        requestId: c.get('requestId'),
        method: c.req.method,
        route: c.req.routePath,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
      }),
    );
  });

  const csrfGuard = csrf({ origin: config.webOrigin });
  app.use('/api/*', (c, next) => (isCsrfExempt(c.req.path) ? next() : csrfGuard(c, next)));

  app.use('/api/*', async (c: Context<AppEnv>, next: Next) => {
    if (isPublic(c.req.path)) return next();
    // Cookie or bearer: the bearer plugin turns a token into the session cookie first.
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session === null) return problem(c, 'unauthenticated');
    const { id, name, email, image } = session.user;
    c.set('user', { id, name, email, image: image ?? null });
    return next();
  });

  app.on(['GET', 'POST'], `${AUTH_PREFIX}*`, (c) => auth.handler(c.req.raw));

  app.openapiRoutes(healthRoutes);
  app.openapiRoutes(meRoutes({ config, db }));
  app.openapiRoutes(exerciseRoutes({ config, db }));

  app.openAPIRegistry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description:
      'Better Auth’s session cookie, set on the web origin. `__Secure-` prefixed over HTTPS.',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
    description: 'The session token from the `set-auth-token` header, for the native client.',
  });

  app.notFound((c) => problem(c, 'not_found'));

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      const code = httpExceptionCodes[error.status];
      if (code !== undefined) return problem(c, code);
    }
    // A stack trace and the request id; no request or row values.
    console.error(
      JSON.stringify({
        requestId: c.get('requestId'),
        error: error.name,
        stack: error.stack,
      }),
    );
    return problem(c, 'internal');
  });

  return app;
}

const httpExceptionCodes: Partial<Record<number, ProblemCode>> = {
  // Malformed JSON, from the body validator.
  400: 'bad_request',
  // csrf() refused a form-type request from another origin (docs/07 §1.3).
  403: 'cross_origin',
};

export type App = ReturnType<typeof createApp>;

export function openApiDocument(app: App) {
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    // Every route needs a session unless it opts out, as the middleware enforces.
    security: [{ session: [] }, { bearer: [] }],
    info: {
      title: 'Overload API',
      version: '1',
      description:
        'Generated from the route schemas in apps/api by `pnpm contract`. Do not edit by hand. ' +
        'Better Auth’s own /api/auth/* routes are not described here.',
    },
  });
}
