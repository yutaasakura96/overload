import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import { lockGoalPhases } from '../db/goal-phases.js';
import { getProfile, updateProfile } from '../db/profile.js';
import { accountHeaders } from '../lib/account.js';
import { problemResponse } from '../lib/problem.js';
import { followTrainingDays } from './plans.js';
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
  description:
    'Changing the training weekdays moves the open goal phase’s calories, while they are still the formula’s, to its figure for the new weekdays, in the same write (S14).',
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

/** The same training weekdays, in any order. */
const sameWeekdays = (a: number[], b: number[]) => {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((day) => set.has(day));
};

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
      handler: async (c) => {
        const userId = c.get('user').id;
        const patch = c.req.valid('json');
        const profile = await db.transaction(async (tx) => {
          await lockGoalPhases(tx, userId);
          const before = await getProfile(tx, userId);
          const after = await updateProfile(tx, userId, patch);
          if (!sameWeekdays(before?.trainingWeekdays ?? [], after.trainingWeekdays)) {
            await followTrainingDays(tx, userId);
          }
          return after;
        });
        return c.json(profile, 200);
      },
    }),
  ] as const;
}
