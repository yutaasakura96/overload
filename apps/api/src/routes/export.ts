import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import { listExercises } from '../db/exercises.js';
import { exportWorkouts } from '../db/history.js';
import { getProfile } from '../db/profile.js';
import { listRoutines } from '../db/routines.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse } from '../lib/problem.js';
import { decodeCursor, encodeCursor, pageQuery } from './paging.js';
import { ExportPage, ExportSection } from './schemas.js';

// S10's export (docs/07 §2). Sectioned and paged because Vercel caps a response body at 4.5 MB; the
// client fetches every section page by page and builds the file in the browser.

/**
 * The tables each section carries, directly or nested. Every table holding a user's rows is here or
 * in NOT_EXPORTED, which a test checks against the database, so a new table cannot be left out of
 * S10 quietly.
 */
export const EXPORTED_TABLES = {
  profile: ['user', 'user_profile'],
  exercises: ['exercise', 'exercise_setting'],
  routines: ['routine', 'routine_exercise'],
  workouts: ['workout', 'workout_exercise', 'set'],
} as const satisfies Record<ExportSection, readonly string[]>;

type ExportSection = z.infer<typeof ExportSection>;

/** Access and bookkeeping, not the user's data (docs/07 §2). */
export const NOT_EXPORTED = [
  // Better Auth's own.
  'session',
  'account',
  'verification',
  'rate_limit',
  'invite',
  'audit_event',
  'sync_tombstone',
  'health_sync_state',
] as const;

const getExport = createRoute({
  method: 'get',
  path: '/api/me/export',
  summary: 'One section of the caller’s export, a page at a time',
  request: { query: z.object({ section: ExportSection, ...pageQuery }) },
  responses: {
    200: {
      description: 'One page of the section, and the cursor of the next',
      headers: accountHeaders,
      content: { 'application/json': { schema: ExportPage } },
    },
    400: problemResponse(
      'An unknown section, a limit outside 1 to 100, or a cursor this route did not make',
    ),
    401: problemResponse('No session'),
  },
});

export function exportRoutes({ db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getExport, AppEnv>({
      route: getExport,
      handler: async (c) => {
        const { section, limit, cursor } = c.req.valid('query');
        const user = c.get('user');
        // The small lists come whole, in one page (docs/07 §1.4).
        if (section === 'profile') {
          const profile = await getProfile(db, user.id);
          const { id, name, email, image } = user;
          return c.json(
            { section, items: [{ user: { id, name, email, image }, profile }], nextCursor: null },
            200,
          );
        }
        if (section === 'exercises') {
          const items = await listExercises(db, user.id, { includeHidden: true });
          return c.json({ section, items, nextCursor: null }, 200);
        }
        if (section === 'routines') {
          return c.json({ section, items: await listRoutines(db, user.id), nextCursor: null }, 200);
        }
        const after = cursor === undefined ? undefined : decodeCursor(cursor);
        if (cursor !== undefined && after === undefined) {
          return problem(c, 'bad_request', { detail: 'Invalid parameter: cursor' });
        }
        const page = await exportWorkouts(db, user.id, { limit, after });
        return c.json(
          {
            section,
            items: page.items,
            nextCursor: page.next === null ? null : encodeCursor(page.next),
          },
          200,
        );
      },
    }),
  ] as const;
}
