import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env';
import { getProfile } from '../db/profile';
import { problemResponse } from '../lib/problem';
import { Me } from './schemas';

const getMe = createRoute({
  method: 'get',
  path: '/api/me',
  summary: 'The signed-in user, their profile, and whether they are the admin',
  responses: {
    200: { description: 'The caller', content: { 'application/json': { schema: Me } } },
    401: problemResponse('No session'),
  },
});

export function meRoutes({ config, db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getMe, AppEnv>({
      route: getMe,
      handler: async (c) => {
        const user = c.get('user');
        return c.json(
          {
            user: { id: user.id, name: user.name, email: user.email, image: user.image },
            // Admin is an env var, not a role column (docs/08 §3).
            isAdmin: user.email.toLowerCase() === config.adminEmail,
            profile: await getProfile(db, user.id),
          },
          200,
        );
      },
    }),
  ] as const;
}
