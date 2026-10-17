import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import type { AppEnv, RouteDeps } from '../app-env.js';
import { getProfile } from '../db/profile.js';
import { localDateIn } from '../db/training.js';
import { createWeighIn, deleteWeighIn, listWeighIns, type WeighIn } from '../db/weigh-ins.js';
import { weightSection } from '../domain/weight.js';
import { accountHeaders } from '../lib/account.js';
import { problem, problemResponse } from '../lib/problem.js';
import { IdParam, WeighIn as WeighInSchema, WeighInCreate, WeighIns, jsonBody } from './schemas.js';

// S11 (docs/07 §5): weigh-ins typed by hand, and the daily weights and trend derived from every
// reading. Deriving needs the profile's time zone, so the read answers `setup_incomplete` without
// one. A weight value never reaches a log or a problem detail (docs/03 §7).

/** A weigh-in as JSON: its instant as ISO 8601 in UTC. */
export const weighInJson = (row: WeighIn) => ({ ...row, measuredAt: row.measuredAt.toISOString() });

const LocalDate = z.iso.date();

const getWeighIns = createRoute({
  method: 'get',
  path: '/api/weigh-ins',
  summary: 'Weigh-ins in a range of local dates, with the daily weights and the trend',
  request: {
    query: z.object({
      from: LocalDate.optional().openapi({
        description: 'The first local date, included. Default: the first weigh-in.',
      }),
      to: LocalDate.optional().openapi({
        description: 'The last local date, included. Default: today.',
      }),
    }),
  },
  responses: {
    200: {
      description: 'The range’s readings and weighed days, newest first, trended from all history',
      headers: accountHeaders,
      content: { 'application/json': { schema: WeighIns } },
    },
    400: problemResponse('A date that is not `YYYY-MM-DD`, or `from` after `to`'),
    401: problemResponse('No session'),
    422: problemResponse(
      '`setup_incomplete` with `missing: ["profile"]`: local dates need the time zone',
    ),
  },
});

const weighInResponse = (description: string) => ({
  description,
  headers: accountHeaders,
  content: { 'application/json': { schema: WeighInSchema } },
});

const postWeighIn = createRoute({
  method: 'post',
  path: '/api/weigh-ins',
  summary: 'Save a weigh-in typed by hand',
  request: { body: jsonBody(WeighInCreate) },
  responses: {
    201: weighInResponse('Created'),
    200: weighInResponse('A repeat of the same create: the stored weigh-in'),
    401: problemResponse('No session'),
    409: problemResponse(
      '`id_conflict`: the id is in use with other content; `weigh_in_exists`: a typed weigh-in at that instant exists',
    ),
    422: problemResponse('`validation_failed`, including a weight outside 20 to 300 kg'),
  },
});

const deleteWeighInRoute = createRoute({
  method: 'delete',
  path: '/api/weigh-ins/{id}',
  summary: 'Delete a typed weigh-in. 204 whenever the caller has no such weigh-in afterwards',
  request: { params: IdParam },
  responses: {
    204: { description: 'The caller has no typed weigh-in with that id', headers: accountHeaders },
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    409: problemResponse(
      '`managed_by_apple_health`: it came from Apple Health, which would send it again; delete it there',
    ),
  },
});

export function weighInRoutes({ db }: RouteDeps) {
  return [
    defineOpenAPIRoute<typeof getWeighIns, AppEnv>({
      route: getWeighIns,
      handler: async (c) => {
        const userId = c.get('user').id;
        const query = c.req.valid('query');
        const profile = await getProfile(db, userId);
        if (profile === null) return problem(c, 'setup_incomplete', { missing: ['profile'] });
        const today = localDateIn(profile.timezone)(new Date());
        const to = query.to ?? today;
        if (query.from !== undefined && query.from > to) {
          return problem(c, 'bad_request', { detail: 'Invalid parameter: from' });
        }
        const section = weightSection(await listWeighIns(db, userId), profile.timezone, {
          from: query.from,
          to,
          today,
        });
        return c.json({ ...section, weighIns: section.weighIns.map(weighInJson) }, 200);
      },
    }),
    defineOpenAPIRoute<typeof postWeighIn, AppEnv>({
      route: postWeighIn,
      handler: async (c) => {
        const result = await createWeighIn(db, c.get('user').id, c.req.valid('json'));
        if (result.kind === 'created') return c.json(weighInJson(result.weighIn), 201);
        if (result.kind === 'existing') return c.json(weighInJson(result.weighIn), 200);
        return problem(c, result.kind);
      },
    }),
    defineOpenAPIRoute<typeof deleteWeighInRoute, AppEnv>({
      route: deleteWeighInRoute,
      handler: async (c) => {
        const result = await deleteWeighIn(db, c.get('user').id, c.req.valid('param').id);
        if (result.kind === 'managed_by_apple_health') return problem(c, result.kind);
        return c.body(null, 204);
      },
    }),
  ] as const;
}
