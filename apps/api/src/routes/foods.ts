import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import type { AppEnv, FoodSources, RouteDeps } from '../app-env.js';
import {
  archiveFood,
  createFood,
  listedBySourceRef,
  listFoods,
  updateFood,
  type Food,
} from '../db/foods.js';
import { takeModelCall } from '../db/model-calls.js';
import { getProfile } from '../db/profile.js';
import { searchReferenceFoods } from '../db/reference-foods.js';
import { localDateIn } from '../db/training.js';
import { impossibleValues, toPer100g, type GivenValues } from '../domain/food.js';
import { accountHeaders } from '../lib/account.js';
import type { FoodCandidate, LabelImage } from '../lib/food-candidate.js';
import { problem, problemResponse } from '../lib/problem.js';
import {
  BarcodeLookup,
  FoodCreate,
  FoodList,
  FoodPatch,
  Food as FoodSchema,
  IdParam,
  LabelReadResult,
  ReferenceFoodList,
  jsonBody,
} from './schemas.js';

// S12, the food list and its sources (docs/07 §4): MEXT search, an Open Food Facts barcode lookup,
// a photo of the 栄養成分表示, then manual entry. The three lookups never save: the user confirms a
// candidate and the client then adds it, with its values on the basis they were read in; the API
// converts to per 100 g (domain/food.ts). No food value, barcode or photo reaches a log or a
// problem detail (docs/03 §7).

/** The photo limit (docs/07 §1.5), under Vercel's own 4.5 MB request cap. */
export const LABEL_PHOTO_MAX_BYTES = 4 * 1024 * 1024;

const LABEL_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** A food as JSON: its archive instant as ISO 8601 in UTC. */
export const foodJson = (row: Food) => ({
  ...row,
  archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
});

const foodResponse = (description: string) => ({
  description,
  headers: accountHeaders,
  content: { 'application/json': { schema: FoodSchema } },
});

const getFoods = createRoute({
  method: 'get',
  path: '/api/foods',
  summary: 'The food list, by name',
  request: {
    query: z.object({
      includeArchived: z
        .enum(['true', 'false'])
        .optional()
        .openapi({ description: 'Include archived foods. Default `false`.' }),
    }),
  },
  responses: {
    200: {
      description: 'Every food on the list, by name',
      headers: accountHeaders,
      content: { 'application/json': { schema: FoodList } },
    },
    400: problemResponse('A parameter of the wrong type'),
    401: problemResponse('No session'),
  },
});

const postFood = createRoute({
  method: 'post',
  path: '/api/foods',
  summary: 'Add a confirmed food, converted to per 100 g',
  request: { body: jsonBody(FoodCreate) },
  responses: {
    201: foodResponse('Created'),
    200: foodResponse('A repeat of the same create: the stored food'),
    401: problemResponse('No session'),
    409: problemResponse(
      '`id_conflict`: the id is in use with other content; `food_exists`: the same barcode, MEXT code, or name, brand and state is on the list, named by `existingFoodId`',
    ),
    422: problemResponse(
      '`validation_failed`, including a basis without its weight, a value above what 100 g can hold, and a rotation group that is not the caller’s',
    ),
  },
});

const patchFood = createRoute({
  method: 'patch',
  path: '/api/foods/{id}',
  summary: 'Edit a food’s values per 100 g, piece weight, keeping days or rotation group',
  request: { params: IdParam, body: jsonBody(FoodPatch) },
  responses: {
    200: foodResponse('The food as it now stands'),
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
    404: problemResponse('The caller has no food with that id'),
    409: problemResponse('`food_exists`: another food on the list has that name, brand and state'),
    422: problemResponse('`validation_failed`'),
  },
});

const deleteFood = createRoute({
  method: 'delete',
  path: '/api/foods/{id}',
  summary: 'Archive a food. Past plans keep it. 204 whenever the caller has no listed food with that id afterwards',
  request: { params: IdParam },
  responses: {
    204: { description: 'Archived, or never on the caller’s list', headers: accountHeaders },
    400: problemResponse('A malformed id'),
    401: problemResponse('No session'),
  },
});

const getReferenceFoods = createRoute({
  method: 'get',
  path: '/api/reference-foods',
  summary: 'Search the MEXT table (八訂 増補2023), 20 results, best match first',
  request: {
    query: z.object({
      q: z.string().trim().min(1).max(80).openapi({
        description: 'Words in the English name or the name as MEXT prints it. Every word must match.',
        example: 'chicken breast',
      }),
    }),
  },
  responses: {
    200: {
      description: 'The matches, best first',
      headers: accountHeaders,
      content: { 'application/json': { schema: ReferenceFoodList } },
    },
    400: problemResponse('`q` empty or over 80 characters'),
    401: problemResponse('No session'),
  },
});

const getBarcode = createRoute({
  method: 'get',
  path: '/api/barcodes/{code}',
  summary: 'Look a barcode up in Open Food Facts. A candidate, never a saved food',
  request: {
    params: z.object({
      code: z
        .string()
        .regex(/^\d{8,14}$/)
        .openapi({ param: { name: 'code', in: 'path' }, example: '4901234567894' }),
    }),
  },
  responses: {
    200: {
      description:
        'The candidate and its values per 100 g; or, when the list has that barcode, `existingFoodId` and no lookup',
      headers: accountHeaders,
      content: { 'application/json': { schema: BarcodeLookup } },
    },
    400: problemResponse('Not a barcode of 8 to 14 digits'),
    401: problemResponse('No session'),
    404: problemResponse('`not_found`: not in Open Food Facts'),
    429: problemResponse('`rate_limited`: Open Food Facts’ 15 reads a minute'),
    502: problemResponse('`upstream_failed`: Open Food Facts did not answer'),
  },
});

const LabelPhoto = z.object({
  image: z.instanceof(File).openapi({
    type: 'string',
    format: 'binary',
    description: 'JPEG, PNG or WebP, at most 4 MB. The client resizes to 1568 px on the long edge.',
  }),
});

const postLabelRead = createRoute({
  method: 'post',
  path: '/api/label-reads',
  summary: 'Read the 栄養成分表示 in a photo. A candidate with its basis, never a saved food',
  request: {
    body: {
      content: { 'multipart/form-data': { schema: LabelPhoto } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'What the label prints, on its basis, and the same per 100 g',
      headers: accountHeaders,
      content: { 'application/json': { schema: LabelReadResult } },
    },
    401: problemResponse('No session'),
    413: problemResponse('`payload_too_large`: over 4 MB'),
    422: problemResponse(
      '`validation_failed`: no image, or not JPEG, PNG or WebP; `unreadable_label`: no nutrition table the model could read',
    ),
    429: problemResponse(
      '`model_cap_reached`: the day’s model calls, label reads and meal estimates together, are used up',
    ),
    502: problemResponse('`upstream_failed`: the reader did not answer, or is not set up'),
  },
});

/** The values of a candidate, as the conversion takes them. */
const givenOf = (candidate: FoodCandidate): GivenValues => ({
  energyKcal: candidate.energyKcal,
  proteinG: candidate.proteinG,
  carbG: candidate.carbG,
  fatG: candidate.fatG,
  fiberG: candidate.fiberG,
});

const FIELD_MESSAGES = {
  basis: 'Give the weight of the piece, serving or package',
  impossible: 'More than 100 g of food can hold',
  rotationGroupId: 'Not one of your rotation groups',
};

const unknownGroup = [{ path: 'rotationGroupId', message: FIELD_MESSAGES.rotationGroupId }];

export function foodRoutes({ db, foodSources }: RouteDeps & { foodSources: FoodSources }) {
  return [
    defineOpenAPIRoute<typeof getFoods, AppEnv>({
      route: getFoods,
      handler: async (c) => {
        const { includeArchived } = c.req.valid('query');
        const items = await listFoods(db, c.get('user').id, {
          includeArchived: includeArchived === 'true',
        });
        return c.json({ items: items.map(foodJson) }, 200);
      },
    }),
    defineOpenAPIRoute<typeof postFood, AppEnv>({
      route: postFood,
      handler: async (c) => {
        const body = c.req.valid('json');
        const values = toPer100g(
          {
            energyKcal: body.energyKcal,
            proteinG: body.proteinG,
            carbG: body.carbG,
            fatG: body.fatG,
            fiberG: body.fiberG,
          },
          body.basis,
        );
        if (values === null) {
          return problem(c, 'validation_failed', {
            errors: [{ path: 'basis.grams', message: FIELD_MESSAGES.basis }],
          });
        }
        const impossible = impossibleValues(values);
        if (impossible.length > 0) {
          return problem(c, 'validation_failed', {
            errors: impossible.map((path) => ({ path, message: FIELD_MESSAGES.impossible })),
          });
        }
        const result = await createFood(db, c.get('user').id, {
          id: body.id,
          name: body.name,
          brand: body.brand ?? null,
          state: body.state,
          energyKcal: values.energyKcal ?? 0,
          proteinG: values.proteinG ?? 0,
          carbG: values.carbG ?? 0,
          fatG: values.fatG ?? 0,
          fiberG: values.fiberG ?? 0,
          pieceWeightG: body.pieceWeightG ?? null,
          keepsDays: body.keepsDays ?? null,
          source: body.source,
          sourceRef: body.sourceRef ?? null,
          rotationGroupId: body.rotationGroupId ?? null,
        });
        if (result.kind === 'created') return c.json(foodJson(result.food), 201);
        if (result.kind === 'existing') return c.json(foodJson(result.food), 200);
        if (result.kind === 'food_exists') {
          return problem(c, 'food_exists', { existingFoodId: result.existingFoodId });
        }
        if (result.kind === 'unknown_rotation_group') {
          return problem(c, 'validation_failed', { errors: unknownGroup });
        }
        return problem(c, 'id_conflict');
      },
    }),
    defineOpenAPIRoute<typeof patchFood, AppEnv>({
      route: patchFood,
      handler: async (c) => {
        const result = await updateFood(
          db,
          c.get('user').id,
          c.req.valid('param').id,
          c.req.valid('json'),
        );
        if (result.kind === 'updated') return c.json(foodJson(result.food), 200);
        if (result.kind === 'food_exists') {
          return problem(c, 'food_exists', { existingFoodId: result.existingFoodId });
        }
        if (result.kind === 'unknown_rotation_group') {
          return problem(c, 'validation_failed', { errors: unknownGroup });
        }
        return problem(c, 'not_found');
      },
    }),
    defineOpenAPIRoute<typeof deleteFood, AppEnv>({
      route: deleteFood,
      handler: async (c) => {
        await archiveFood(db, c.get('user').id, c.req.valid('param').id);
        return c.body(null, 204);
      },
    }),
    defineOpenAPIRoute<typeof getReferenceFoods, AppEnv>({
      route: getReferenceFoods,
      handler: async (c) => {
        const found = await searchReferenceFoods(db, c.req.valid('query').q);
        const listed = await listedBySourceRef(db, c.get('user').id, {
          mext: true,
          sourceRefs: found.map((entry) => entry.code),
        });
        const items = found.map((entry) => ({
          ...entry,
          existingFoodId: listed.get(entry.code) ?? null,
        }));
        return c.json({ items }, 200);
      },
    }),
    defineOpenAPIRoute<typeof getBarcode, AppEnv>({
      route: getBarcode,
      handler: async (c) => {
        const { code } = c.req.valid('param');
        const listed = await listedBySourceRef(db, c.get('user').id, {
          mext: false,
          sourceRefs: [code],
        });
        const existingFoodId = listed.get(code);
        // On the list already: the existing food opens, and Open Food Facts is not asked.
        if (existingFoodId !== undefined) {
          return c.json({ candidate: null, per100g: null, existingFoodId }, 200);
        }
        const found = await foodSources.openFoodFacts.lookup(code);
        if (found.kind === 'not_found') return problem(c, 'not_found');
        if (found.kind === 'rate_limited') return problem(c, 'rate_limited');
        if (found.kind === 'failed') return problem(c, 'upstream_failed');
        const { candidate } = found;
        return c.json(
          {
            candidate,
            per100g: toPer100g(givenOf(candidate), candidate.basis),
            existingFoodId: null,
          },
          200,
        );
      },
    }),
    defineOpenAPIRoute<typeof postLabelRead, AppEnv>({
      route: postLabelRead,
      handler: async (c) => {
        const { image } = c.req.valid('form');
        const mediaType = LABEL_TYPES.find((type) => type === image.type);
        if (mediaType === undefined) {
          return problem(c, 'validation_failed', {
            errors: [{ path: 'image', message: 'Send a JPEG, PNG or WebP photo' }],
          });
        }
        if (image.size > LABEL_PHOTO_MAX_BYTES) return problem(c, 'payload_too_large');
        const reader = foodSources.labelReader;
        // Not set up yet (no Anthropic key): no call is made, so none is counted.
        if (reader === null) return problem(c, 'upstream_failed');

        const userId = c.get('user').id;
        const profile = await getProfile(db, userId);
        const day = localDateIn(profile?.timezone ?? 'Asia/Tokyo')(new Date());
        // Counted before the call: a read made counts even when the user then abandons it (F9).
        if (!(await takeModelCall(db, userId, day))) return problem(c, 'model_cap_reached');

        const photo: LabelImage = { data: new Uint8Array(await image.arrayBuffer()), mediaType };
        const read = await reader.read(photo);
        if (read.kind === 'unreadable') return problem(c, 'unreadable_label');
        if (read.kind === 'failed') return problem(c, 'upstream_failed');
        const { candidate } = read;
        return c.json(
          {
            candidate,
            per100g: toPer100g(givenOf(candidate), candidate.basis),
            model: read.model,
          },
          200,
        );
      },
    }),
  ] as const;
}
