import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import { getWorkout, listWorkouts, type WorkoutCursor } from '../db/history.js';
import { getProfile } from '../db/profile.js';
import { lastTimes, localDateIn, loggedExercises, loggedLifts } from '../db/training.js';
import { BALANCE_VIEWS, balanceWindow, weeklySets } from '../domain/balance.js';
import { syncWorkouts } from '../db/workouts.js';
import { spanStart } from '../domain/progress.js';
import { STRENGTH_SPANS, strengthOverview } from '../domain/strength.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse, validationErrors } from '../lib/problem.js';
import {
  Balance,
  IdParam,
  LastTimes,
  SetRow,
  StrengthOverview,
  SyncBatch,
  SyncDeletion,
  SyncResponse,
  Uuid,
  WorkoutDetail,
  WorkoutExerciseRow,
  WorkoutList,
  WorkoutRow,
  jsonBody,
} from './schemas.js';

// S1, S2 and S3 (docs/07 §3). The sync batch is the only write path for the workout tree, because
// it is made and edited offline; last time is one call so the gym screen has it with no signal.
// History reads what the batch wrote: the list of finished workouts, and one workout whole. The
// strength overview reads the same sets, every exercise at once, and the balance view reads them
// by muscle group.

/** The uploader splits a larger queue (docs/07 §3.4). */
export const SYNC_ROW_LIMIT = 500;

/**
 * One element of a batch as the sync applies it: its deletion, its row, or the fields that make it
 * neither. The request schema lets the last through so it is refused on its own (docs/07 §3.4).
 */
function readRow<Row>(schema: z.ZodType<Row>, row: { id: string }) {
  const deletion = SyncDeletion.safeParse(row);
  if (deletion.success) return deletion.data;
  const read = schema.safeParse(row);
  return read.success ? read.data : { id: row.id, errors: validationErrors(read.error) };
}

const getLastTime = createRoute({
  method: 'get',
  path: '/api/training/last-time',
  summary: 'Last time and today’s suggestion for every exercise the caller has logged',
  responses: {
    200: {
      description: 'One entry per logged exercise',
      headers: accountHeaders,
      content: { 'application/json': { schema: LastTimes } },
    },
    401: problemResponse('No session'),
    422: problemResponse(
      '`setup_incomplete` with `missing: ["profile"]`: local dates need the time zone',
    ),
  },
});

const getStrength = createRoute({
  method: 'get',
  path: '/api/training/strength',
  summary: 'Whether each lift, and all of them together, is gaining, holding or losing over a span',
  request: {
    query: z.object({
      span: z.enum(STRENGTH_SPANS).default('12w').openapi({ description: 'Default `12w`.' }),
    }),
  },
  responses: {
    200: {
      description: 'One entry per exercise logged in the span, with its points, trend and status',
      headers: accountHeaders,
      content: { 'application/json': { schema: StrengthOverview } },
    },
    400: problemResponse('A span that is not `4w`, `12w` or `1y`'),
    401: problemResponse('No session'),
    422: problemResponse(
      '`setup_incomplete` with `missing: ["profile"]`: local dates need the time zone',
    ),
  },
});

const getBalance = createRoute({
  method: 'get',
  path: '/api/training/balance',
  summary: 'Working sets a week for each muscle group, over four weeks or this week',
  request: {
    query: z.object({
      view: z.enum(BALANCE_VIEWS).default('4w').openapi({
        description:
          'Default `4w`, the average of the last four weeks; `week` is this week so far.',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Every muscle group, its sets a week, its status and where the sets came from',
      headers: accountHeaders,
      content: { 'application/json': { schema: Balance } },
    },
    400: problemResponse('A view that is not `4w` or `week`'),
    401: problemResponse('No session'),
    422: problemResponse(
      '`setup_incomplete` with `missing: ["profile"]`: local dates need the time zone',
    ),
  },
});

const postSync = createRoute({
  method: 'post',
  path: '/api/workouts/sync',
  summary: 'Apply the device’s queued workouts, workout exercises and sets',
  request: { body: jsonBody(SyncBatch) },
  responses: {
    200: {
      description:
        'A result per row sent. Refusals do not fail the request; each is reported on its row, ' +
        'a row that does not match its schema included',
      headers: accountHeaders,
      content: { 'application/json': { schema: SyncResponse } },
    },
    401: problemResponse('No session. Nothing was applied'),
    413: problemResponse('`payload_too_large`: more than 500 rows'),
    422: problemResponse(
      '`validation_failed`: the batch is not three arrays of rows that each carry an id',
    ),
  },
});

/** A page's default and largest size (docs/07 §1.4). */
const PAGE_DEFAULT = 30;
const PAGE_MAX = 100;

const CursorFields = z.tuple([z.iso.datetime({ offset: true }), Uuid]);

/** The cursor is opaque to the client: the last row's sort key and id, encoded (docs/07 §1.4). */
const encodeCursor = (cursor: WorkoutCursor) =>
  Buffer.from(JSON.stringify([cursor.startedAt, cursor.id])).toString('base64url');

function decodeCursor(text: string): WorkoutCursor | undefined {
  try {
    const read = CursorFields.safeParse(JSON.parse(Buffer.from(text, 'base64url').toString()));
    return read.success ? { startedAt: read.data[0], id: read.data[1] } : undefined;
  } catch {
    return undefined;
  }
}

const getWorkouts = createRoute({
  method: 'get',
  path: '/api/workouts',
  summary: 'History: the caller’s finished workouts, newest first, a page at a time',
  request: {
    query: z.object({
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(PAGE_MAX)
        .default(PAGE_DEFAULT)
        .openapi({ description: 'Default 30, at most 100.' }),
      cursor: z.string().optional().openapi({ description: 'The previous page’s `nextCursor`.' }),
    }),
  },
  responses: {
    200: {
      description: 'One page, and the cursor of the next',
      headers: accountHeaders,
      content: { 'application/json': { schema: WorkoutList } },
    },
    400: problemResponse('A limit outside 1 to 100, or a cursor this route did not make'),
    401: problemResponse('No session'),
  },
});

const getWorkoutById = createRoute({
  method: 'get',
  path: '/api/workouts/{id}',
  summary: 'One workout with its exercises and every set',
  request: { params: IdParam },
  responses: {
    200: {
      description: 'The workout',
      headers: accountHeaders,
      content: { 'application/json': { schema: WorkoutDetail } },
    },
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('No workout with that id is the caller’s'),
  },
});

export function trainingRoutes({ db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getWorkouts, AppEnv>({
      route: getWorkouts,
      handler: async (c) => {
        const { limit, cursor } = c.req.valid('query');
        const after = cursor === undefined ? undefined : decodeCursor(cursor);
        if (cursor !== undefined && after === undefined) {
          return problem(c, 'bad_request', { detail: 'Invalid parameter: cursor' });
        }
        const page = await listWorkouts(db, c.get('user').id, { limit, after });
        return c.json(
          {
            items: page.items,
            nextCursor: page.next === null ? null : encodeCursor(page.next),
            total: page.total,
          },
          200,
        );
      },
    }),
    defineOpenAPIRoute<typeof getWorkoutById, AppEnv>({
      route: getWorkoutById,
      handler: async (c) => {
        const found = await getWorkout(db, c.get('user').id, c.req.valid('param').id);
        return found === undefined ? problem(c, 'not_found') : c.json(found, 200);
      },
    }),
    defineOpenAPIRoute<typeof getLastTime, AppEnv>({
      route: getLastTime,
      handler: async (c) => {
        const userId = c.get('user').id;
        const profile = await getProfile(db, userId);
        if (profile === null) return problem(c, 'setup_incomplete', { missing: ['profile'] });
        return c.json(
          {
            asOf: new Date().toISOString(),
            exercises: await lastTimes(db, userId, profile.timezone),
          },
          200,
        );
      },
    }),
    defineOpenAPIRoute<typeof getStrength, AppEnv>({
      route: getStrength,
      handler: async (c) => {
        const userId = c.get('user').id;
        const { span } = c.req.valid('query');
        const profile = await getProfile(db, userId);
        if (profile === null) return problem(c, 'setup_incomplete', { missing: ['profile'] });
        const today = localDateIn(profile.timezone)(new Date());
        const lifts = await loggedLifts(db, userId, profile.timezone, spanStart(span, today));
        return c.json(strengthOverview(span, today, lifts), 200);
      },
    }),
    defineOpenAPIRoute<typeof getBalance, AppEnv>({
      route: getBalance,
      handler: async (c) => {
        const userId = c.get('user').id;
        const { view } = c.req.valid('query');
        const profile = await getProfile(db, userId);
        if (profile === null) return problem(c, 'setup_incomplete', { missing: ['profile'] });
        const today = localDateIn(profile.timezone)(new Date());
        const { from } = balanceWindow(view, today);
        const logged = await loggedExercises(db, userId, profile.timezone, from);
        return c.json(weeklySets(view, today, logged), 200);
      },
    }),
    defineOpenAPIRoute<typeof postSync, AppEnv>({
      route: postSync,
      handler: async (c) => {
        const batch = c.req.valid('json');
        const count = batch.workouts.length + batch.workoutExercises.length + batch.sets.length;
        if (count > SYNC_ROW_LIMIT) return problem(c, 'payload_too_large');
        const rows = {
          workouts: batch.workouts.map((row) => readRow(WorkoutRow, row)),
          workoutExercises: batch.workoutExercises.map((row) => readRow(WorkoutExerciseRow, row)),
          sets: batch.sets.map((row) => readRow(SetRow, row)),
        };
        return c.json({ results: await syncWorkouts(db, c.get('user').id, rows) }, 200);
      },
    }),
  ] as const;
}
