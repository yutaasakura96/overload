import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env';
import { listExercises } from '../db/exercises';
import { problemResponse } from '../lib/problem';
import { ExerciseList } from './schemas';

// Slice 1 reads the library. Create, edit, delete and the per-user setting land in slice 2
// (docs/06, 2026-09-24).
const getExercises = createRoute({
  method: 'get',
  path: '/api/exercises',
  summary: 'Seeded exercises plus the caller’s own, with the caller’s effective settings, by name',
  request: {
    query: z.object({
      includeHidden: z
        .enum(['true', 'false'])
        .optional()
        .openapi({ description: 'Include exercises the caller has hidden. Default `false`.' }),
    }),
  },
  responses: {
    200: { description: 'The library', content: { 'application/json': { schema: ExerciseList } } },
    400: problemResponse('A query parameter of the wrong type'),
    401: problemResponse('No session'),
  },
});

export function exerciseRoutes({ db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getExercises, AppEnv>({
      route: getExercises,
      handler: async (c) => {
        const { includeHidden } = c.req.valid('query');
        const items = await listExercises(db, c.get('user').id, {
          includeHidden: includeHidden === 'true',
        });
        return c.json({ items }, 200);
      },
    }),
  ] as const;
}
