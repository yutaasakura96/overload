import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import { getProfile, updateProfile } from '../db/profile.js';
import { accountHeaders } from '../lib/account.js';
import { problemResponse } from '../lib/problem.js';
import { Me, Profile, ProfilePatch, jsonBody } from './schemas.js';

const getMe = createRoute({
  method: 'get',
  path: '/api/me',
  summary: 'The signed-in user, their profile, and whether they are the admin',
  responses: {
    200: {
      description: 'The caller',
      headers: accountHeaders,
      content: { 'application/json': { schema: Me } },
    },
    401: problemResponse('No session'),
  },
});

const patchProfile = createRoute({
  method: 'patch',
  path: '/api/me/profile',
  summary: 'Set profile fields. The first save creates the profile',
  request: { body: jsonBody(ProfilePatch) },
  responses: {
    200: {
      description: 'The profile',
      headers: accountHeaders,
      content: { 'application/json': { schema: Profile } },
    },
    401: problemResponse('No session'),
    422: problemResponse('`validation_failed`, including an unknown time zone'),
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
    defineOpenAPIRoute<typeof patchProfile, AppEnv>({
      route: patchProfile,
      handler: async (c) =>
        c.json(await updateProfile(db, c.get('user').id, c.req.valid('json')), 200),
    }),
  ] as const;
}
