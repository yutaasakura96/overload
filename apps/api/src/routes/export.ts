import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import { exportExercises } from '../db/exercises.js';
import { exportFoods } from '../db/foods.js';
import { exportWorkouts } from '../db/history.js';
import { getProfile } from '../db/profile.js';
import { exportRotationGroups } from '../db/rotation-groups.js';
import { exportRoutines } from '../db/routines.js';
import { exportWeighIns } from '../db/weigh-ins.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse } from '../lib/problem.js';
import { pageQuery } from './paging.js';
import { ExportPage, ExportSection, Uuid } from './schemas.js';
import { foodJson } from './foods.js';
import { weighInJson } from './weigh-ins.js';

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
  weighIns: ['body_measurement'],
  foods: ['food'],
  rotationGroups: ['rotation_group'],
} as const satisfies Record<ExportSection, readonly string[]>;

type ExportSection = z.infer<typeof ExportSection>;

const ExportCursor = z.discriminatedUnion('section', [
  z.object({ section: z.literal('exercises'), name: z.string(), id: Uuid }),
  z.object({ section: z.literal('routines'), position: z.number().int(), id: Uuid }),
  z.object({
    section: z.literal('workouts'),
    startedAt: z.iso.datetime({ offset: true }),
    id: Uuid,
  }),
  z.object({
    section: z.literal('weighIns'),
    measuredAt: z.iso.datetime({ offset: true }),
    id: Uuid,
  }),
  z.object({ section: z.literal('foods'), id: Uuid }),
  z.object({ section: z.literal('rotationGroups'), id: Uuid }),
]);

type ExportCursor = z.infer<typeof ExportCursor>;

const encodeExportCursor = (cursor: ExportCursor) =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

function decodeExportCursor(text: string): ExportCursor | undefined {
  try {
    const read = ExportCursor.safeParse(JSON.parse(Buffer.from(text, 'base64url').toString()));
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
}

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
  // The daily count of model calls, against the cap (docs/06, 2026-09-22).
  'model_call_count',
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
      'An unknown section, a limit outside 1 to 100, or a cursor that does not decode to this section’s sort key and id',
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
        const after = cursor === undefined ? undefined : decodeExportCursor(cursor);
        if (
          (cursor !== undefined && (after === undefined || after.section !== section)) ||
          (section === 'profile' && cursor !== undefined)
        ) {
          return problem(c, 'bad_request', { detail: 'Invalid parameter: cursor' });
        }
        if (section === 'profile') {
          const profile = await getProfile(db, user.id);
          const { id, name, email, image } = user;
          return c.json(
            { section, items: [{ user: { id, name, email, image }, profile }], nextCursor: null },
            200,
          );
        }
        if (section === 'exercises') {
          const page = await exportExercises(db, user.id, {
            limit,
            after: after?.section === 'exercises' ? after : undefined,
          });
          return c.json(
            {
              section,
              items: page.items,
              nextCursor: page.next === null ? null : encodeExportCursor({ section, ...page.next }),
            },
            200,
          );
        }
        if (section === 'routines') {
          const page = await exportRoutines(db, user.id, {
            limit,
            after: after?.section === 'routines' ? after : undefined,
          });
          return c.json(
            {
              section,
              items: page.items,
              nextCursor: page.next === null ? null : encodeExportCursor({ section, ...page.next }),
            },
            200,
          );
        }
        if (section === 'weighIns') {
          const page = await exportWeighIns(db, user.id, {
            limit,
            after: after?.section === 'weighIns' ? after : undefined,
          });
          return c.json(
            {
              section,
              items: page.items.map(weighInJson),
              nextCursor: page.next === null ? null : encodeExportCursor({ section, ...page.next }),
            },
            200,
          );
        }
        if (section === 'foods') {
          const page = await exportFoods(db, user.id, {
            limit,
            after: after?.section === 'foods' ? after : undefined,
          });
          return c.json(
            {
              section,
              items: page.items.map(foodJson),
              nextCursor: page.next === null ? null : encodeExportCursor({ section, ...page.next }),
            },
            200,
          );
        }
        if (section === 'rotationGroups') {
          const page = await exportRotationGroups(db, user.id, {
            limit,
            after: after?.section === 'rotationGroups' ? after : undefined,
          });
          return c.json(
            {
              section,
              items: page.items,
              nextCursor: page.next === null ? null : encodeExportCursor({ section, ...page.next }),
            },
            200,
          );
        }
        const page = await exportWorkouts(db, user.id, {
          limit,
          after: after?.section === 'workouts' ? after : undefined,
        });
        return c.json(
          {
            section,
            items: page.items,
            nextCursor: page.next === null ? null : encodeExportCursor({ section, ...page.next }),
          },
          200,
        );
      },
    }),
  ] as const;
}
