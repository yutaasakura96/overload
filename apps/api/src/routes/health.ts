import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../app-env';
import { Health } from './schemas';

// The uptime check's target, every 5 minutes (docs/12 §5). It must never touch the database, or
// the check alone would keep Neon's compute awake all month.
const getHealth = createRoute({
  method: 'get',
  path: '/api/health',
  summary: 'Liveness. Answers without touching the database',
  security: [],
  responses: {
    200: {
      description: 'The function is running',
      content: { 'application/json': { schema: Health } },
    },
  },
});

export const healthRoutes = [
  defineOpenAPIRoute<typeof getHealth, AppEnv>({
    route: getHealth,
    handler: (c) => c.json({ status: 'ok' as const }, 200),
  }),
] as const;
