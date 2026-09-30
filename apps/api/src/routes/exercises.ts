import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv, RouteDeps } from '../app-env.js';
import {
  createExercise,
  deleteExercise,
  listExercises,
  putExerciseSetting,
  updateExercise,
} from '../db/exercises.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse } from '../lib/problem.js';
import {
  Exercise,
  ExerciseCreate,
  ExerciseList,
  ExercisePatch,
  ExerciseSettingPut,
  IdParam,
  jsonBody,
} from './schemas.js';

// S8 (docs/07 §3.2). Slice 1 read the library; slice 2 adds create, edit, delete and the per-user
// setting, which S4's picker gives a screen (docs/06, 2026-09-24).

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
    200: {
      description: 'The library',
      headers: accountHeaders,
      content: { 'application/json': { schema: ExerciseList } },
    },
    400: problemResponse('A query parameter of the wrong type'),
    401: problemResponse('No session'),
  },
});

const exerciseResponse = (description: string) => ({
  description,
  headers: accountHeaders,
  content: { 'application/json': { schema: Exercise } },
});

const postExercise = createRoute({
  method: 'post',
  path: '/api/exercises',
  summary: 'Create a custom exercise, visible only to the caller',
  request: { body: jsonBody(ExerciseCreate) },
  responses: {
    201: exerciseResponse('Created'),
    200: exerciseResponse('A repeat of the same create: the stored exercise'),
    401: problemResponse('No session'),
    409: problemResponse('`id_conflict`: the id is in use with different content'),
    422: problemResponse('`validation_failed`, including a name the caller already uses'),
  },
});

const patchExercise = createRoute({
  method: 'patch',
  path: '/api/exercises/{id}',
  summary: 'Edit a custom exercise’s name, equipment or defaults. A seeded one is not found',
  request: { params: IdParam, body: jsonBody(ExercisePatch) },
  responses: {
    200: exerciseResponse('The exercise as the caller now sees it'),
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('No custom exercise with that id belongs to the caller'),
    422: problemResponse('`validation_failed`, including an inverted rep range or a name in use'),
  },
});

const deleteExerciseRoute = createRoute({
  method: 'delete',
  path: '/api/exercises/{id}',
  summary: 'Delete a custom exercise. 204 whenever the caller has no such exercise afterwards',
  request: { params: IdParam },
  responses: {
    204: { description: 'The caller has no custom exercise with that id', headers: accountHeaders },
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    409: problemResponse('`exercise_in_routine`, listing the routines that use it'),
  },
});

const putSetting = createRoute({
  method: 'put',
  path: '/api/exercises/{id}/setting',
  summary: 'The caller’s increment, rest, rep range and hidden flag for any exercise',
  request: { params: IdParam, body: jsonBody(ExerciseSettingPut) },
  responses: {
    200: exerciseResponse('The exercise as the caller now sees it'),
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('No exercise with that id is visible to the caller'),
    422: problemResponse('`validation_failed`, including an effective rep range that is inverted'),
  },
});

const fieldRefused = (c: Context<AppEnv>, path: string, message: string) =>
  problem(c, 'validation_failed', { errors: [{ path, message }] });

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
    defineOpenAPIRoute<typeof postExercise, AppEnv>({
      route: postExercise,
      handler: async (c) => {
        const result = await createExercise(db, c.get('user').id, c.req.valid('json'));
        if (result.kind === 'created') return c.json(result.exercise, 201);
        if (result.kind === 'existing') return c.json(result.exercise, 200);
        if (result.kind === 'id_conflict') return problem(c, 'id_conflict');
        return fieldRefused(c, 'name', 'You already have an exercise with this name');
      },
    }),
    defineOpenAPIRoute<typeof patchExercise, AppEnv>({
      route: patchExercise,
      handler: async (c) => {
        const { id } = c.req.valid('param');
        const result = await updateExercise(db, c.get('user').id, id, c.req.valid('json'));
        if (result.kind === 'updated') return c.json(result.exercise, 200);
        if (result.kind === 'not_found') return problem(c, 'not_found');
        if (result.kind === 'duplicate_name') {
          return fieldRefused(c, 'name', 'You already have an exercise with this name');
        }
        return fieldRefused(c, 'repLow', 'repLow must not exceed repHigh');
      },
    }),
    defineOpenAPIRoute<typeof deleteExerciseRoute, AppEnv>({
      route: deleteExerciseRoute,
      handler: async (c) => {
        const { id } = c.req.valid('param');
        const result = await deleteExercise(db, c.get('user').id, id);
        if (result.kind === 'in_routine') {
          return problem(c, 'exercise_in_routine', { routines: result.routines });
        }
        return c.body(null, 204);
      },
    }),
    defineOpenAPIRoute<typeof putSetting, AppEnv>({
      route: putSetting,
      handler: async (c) => {
        const { id } = c.req.valid('param');
        const result = await putExerciseSetting(db, c.get('user').id, id, c.req.valid('json'));
        if (result.kind === 'saved') return c.json(result.exercise, 200);
        if (result.kind === 'not_found') return problem(c, 'not_found');
        return fieldRefused(c, 'repLow', 'repLow must not exceed repHigh');
      },
    }),
  ] as const;
}
