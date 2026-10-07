import { createRoute, defineOpenAPIRoute, type z } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import { getProfile } from '../db/profile.js';
import { lastTimes } from '../db/training.js';
import { syncWorkouts } from '../db/workouts.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse, validationErrors } from '../lib/problem.js';
import {
  LastTimes,
  SetRow,
  SyncBatch,
  SyncDeletion,
  SyncResponse,
  WorkoutExerciseRow,
  WorkoutRow,
  jsonBody,
} from './schemas.js';

// S1, S2 and S3 (docs/07 §3). The sync batch is the only write path for the workout tree, because
// it is made and edited offline; last time is one call so the gym screen has it with no signal.

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

export function trainingRoutes({ db }: RouteDeps) {
  return [
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
