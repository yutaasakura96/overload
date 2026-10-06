import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import { getProfile } from '../db/profile.js';
import { lastTimes } from '../db/training.js';
import { syncWorkouts } from '../db/workouts.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse } from '../lib/problem.js';
import { LastTimes, SyncBatch, SyncResponse, jsonBody } from './schemas.js';

// S1, S2 and S3 (docs/07 §3). The sync batch is the only write path for the workout tree, because
// it is made and edited offline; last time is one call so the gym screen has it with no signal.

/** The uploader splits a larger queue (docs/07 §3.4). */
export const SYNC_ROW_LIMIT = 500;

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
        'A result per row sent. Refusals do not fail the request; each is reported on its row',
      headers: accountHeaders,
      content: { 'application/json': { schema: SyncResponse } },
    },
    401: problemResponse('No session. Nothing was applied'),
    413: problemResponse('`payload_too_large`: more than 500 rows'),
    422: problemResponse('`validation_failed`: the batch did not match its schema'),
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
        const rows = batch.workouts.length + batch.workoutExercises.length + batch.sets.length;
        if (rows > SYNC_ROW_LIMIT) return problem(c, 'payload_too_large');
        return c.json({ results: await syncWorkouts(db, c.get('user').id, batch) }, 200);
      },
    }),
  ] as const;
}
