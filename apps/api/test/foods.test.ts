import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { food, modelCallCount } from '../src/db/schema';
import { MODEL_CALLS_PER_DAY } from '../src/db/model-calls';
import type { BarcodeLookup, LabelImage, LabelRead } from '../src/lib/food-candidate';
import { openFoodFacts } from '../src/lib/open-food-facts';
import { sender } from './account-fixture';
import { WEB_ORIGIN, useTestApp } from './harness';

// S12's routes (docs/07 §4, issue #78): adding a confirmed food from each source, converted to per
// 100 g; one barcode, MEXT code, or name, brand and state on the list once; archiving; the MEXT
// search; the barcode lookup and the label read against stubs; the daily model-call cap; and each
// route's cross-user case (docs/08 §10).

const lookups: string[] = [];
let barcodeAnswer: BarcodeLookup = { kind: 'not_found' };
const reads: LabelImage[] = [];
let labelAnswer: LabelRead = { kind: 'unreadable' };

const t = useTestApp({
  foodSources: {
    openFoodFacts: {
      lookup: async (barcode) => {
        lookups.push(barcode);
        return barcodeAnswer;
      },
    },
    labelReader: {
      read: async (image) => {
        reads.push(image);
        return labelAnswer;
      },
    },
  },
});

/** The same app with no reader set up, as until the owner sets the Anthropic key. */
const unset = useTestApp();

let upstreamProduct: Record<string, unknown> = {};
const volumeSource = useTestApp({
  foodSources: {
    openFoodFacts: openFoodFacts({
      userAgent: 'Overload test',
      fetch: async () =>
        new Response(JSON.stringify({ status: 1, product: upstreamProduct }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    }),
    labelReader: null,
  },
});

/** The same sources, keeping the request log's lines. */
const logLines: string[] = [];
const logged = useTestApp({
  log: (line) => logLines.push(line),
  foodSources: {
    openFoodFacts: { lookup: async () => barcodeAnswer },
    labelReader: { read: async () => labelAnswer },
  },
});

type Food = {
  id: string;
  name: string;
  brand: string | null;
  state: string;
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
  pieceWeightG: number | null;
  keepsDays: number | null;
  source: string;
  sourceRef: string | null;
  rotationGroupId: string | null;
  archivedAt: string | null;
};

async function member(email: string, app = t) {
  const { cookie, user } = await app.createSignedInUser(email);
  return { cookie, user, send: sender(app, cookie) };
}

const per100 = (values: Partial<Record<string, unknown>> = {}) => ({
  id: randomUUID(),
  name: 'Chicken breast, skinless',
  state: 'raw',
  basis: { kind: 'per_100g', grams: null },
  energyKcal: 105,
  proteinG: 23.3,
  carbG: 0.1,
  fatG: 1.9,
  fiberG: 0,
  source: 'mext',
  sourceRef: '11220',
  ...values,
});

async function add(send: ReturnType<typeof sender>, body: Record<string, unknown>) {
  const res = await send('POST', '/api/foods', body);
  expect(res.status).toBe(201);
  const created: Food = await res.json();
  return created;
}

async function listOf(send: ReturnType<typeof sender>, query = '') {
  const res = await send('GET', `/api/foods${query}`);
  expect(res.status).toBe(200);
  const body: { items: Food[] } = await res.json();
  return body.items;
}

describe('POST /api/foods', () => {
  it('saves a confirmed food under the device’s id, and a repeat returns the stored food', async () => {
    const { send, user } = await member('add@example.test');
    const body = per100({ pieceWeightG: null, keepsDays: 4 });

    const created = await add(send, body);
    expect(created).toEqual({
      id: body.id,
      name: 'Chicken breast, skinless',
      brand: null,
      state: 'raw',
      energyKcal: 105,
      proteinG: 23.3,
      carbG: 0.1,
      fatG: 1.9,
      fiberG: 0,
      pieceWeightG: null,
      keepsDays: 4,
      source: 'mext',
      sourceRef: '11220',
      rotationGroupId: null,
      archivedAt: null,
    });

    const again = await send('POST', '/api/foods', body);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(created);
    expect(await t.db.select().from(food).where(eq(food.userId, user.id))).toHaveLength(1);
  });

  it('converts a label’s package values to per 100 g, and has no basis in the answer', async () => {
    const { send } = await member('package@example.test');
    const created = await add(send, {
      id: randomUUID(),
      name: 'サラダチキン プレーン',
      state: 'cooked',
      basis: { kind: 'per_package', grams: 110 },
      energyKcal: 121,
      proteinG: 26.4,
      carbG: 0.3,
      fatG: 1.5,
      fiberG: null,
      source: 'label_photo',
      sourceRef: '4901234567894',
    });
    expect(created).toMatchObject({
      energyKcal: 110,
      proteinG: 24,
      carbG: 0.27,
      fatG: 1.36,
      fiberG: 0,
    });
    expect(created).not.toHaveProperty('basis');
  });

  it('converts a piece typed by hand, and keeps what one piece weighs', async () => {
    const { send } = await member('piece@example.test');
    const created = await add(send, {
      ...per100({ name: '卵 M', source: 'manual', sourceRef: null }),
      basis: { kind: 'per_piece', grams: 55 },
      energyKcal: 78.1,
      proteinG: 6.71,
      carbG: 0.17,
      fatG: 5.61,
      pieceWeightG: 55,
    });
    expect(created).toMatchObject({ energyKcal: 142, proteinG: 12.2, pieceWeightG: 55 });
  });

  it('rounds a typed piece only after converting to per 100 g', async () => {
    const { send } = await member('precise-piece@example.test');
    const created = await add(send, {
      ...per100({ name: 'Small protein piece', source: 'manual', sourceRef: null }),
      basis: { kind: 'per_piece', grams: 15 },
      energyKcal: 15,
      proteinG: 0.015,
      carbG: 0,
      fatG: 0,
      fiberG: null,
    });
    expect(created.proteinG).toBe(0.1);
  });

  it('refuses a basis without its weight, and values 100 g cannot hold', async () => {
    const { send } = await member('refused@example.test');
    const noWeight = await send(
      'POST',
      '/api/foods',
      per100({ basis: { kind: 'per_serving', grams: null }, source: 'manual', sourceRef: null }),
    );
    expect(noWeight.status).toBe(422);
    expect((await noWeight.json()).errors).toEqual([
      { path: 'basis.grams', message: 'Give the weight of the piece, serving or package' },
    ]);

    const tooMuch = await send(
      'POST',
      '/api/foods',
      per100({ basis: { kind: 'per_package', grams: 10 }, proteinG: 23.3 }),
    );
    expect(tooMuch.status).toBe(422);
    expect((await tooMuch.json()).errors.map((e: { path: string }) => e.path)).toEqual([
      'energyKcal',
      'proteinG',
    ]);
  });

  it('refuses the same barcode, MEXT code, or name, brand and state twice, naming the food', async () => {
    const { send } = await member('dupes@example.test');
    const first = await add(send, per100());

    for (const body of [
      per100({ name: 'Another name' }),
      per100({ name: 'chicken BREAST, skinless', sourceRef: null, source: 'manual' }),
    ]) {
      const res = await send('POST', '/api/foods', body);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'food_exists', existingFoodId: first.id });
    }

    const barcoded = await add(
      send,
      per100({ name: 'Oats', source: 'open_food_facts', sourceRef: '4901234567894' }),
    );
    const sameBarcode = await send(
      'POST',
      '/api/foods',
      per100({ name: 'Oats again', source: 'label_photo', sourceRef: '4901234567894' }),
    );
    expect(await sameBarcode.json()).toMatchObject({
      code: 'food_exists',
      existingFoodId: barcoded.id,
    });

    // A MEXT code and a barcode are different keys; and the same name raw and cooked are two foods.
    await add(send, per100({ name: 'Number 11220', source: 'manual', sourceRef: '11220' }));
    await add(send, per100({ state: 'cooked', sourceRef: '11221' }));
  });

  it('answers id_conflict for an id in use with other content', async () => {
    const { send } = await member('conflict@example.test');
    const body = per100();
    await add(send, body);
    const res = await send('POST', '/api/foods', { ...body, energyKcal: 120 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('id_conflict');
  });
});

describe('GET, PATCH and DELETE /api/foods', () => {
  it('lists foods by name, archived ones only when asked for', async () => {
    const { send } = await member('list@example.test');
    const rice = await add(send, per100({ name: 'white rice', sourceRef: '01088' }));
    const broccoli = await add(send, per100({ name: 'Broccoli', sourceRef: '06263' }));
    const okra = await add(send, per100({ name: 'Okra', sourceRef: '06189' }));

    expect((await listOf(send)).map((f) => f.name)).toEqual(['Broccoli', 'Okra', 'white rice']);

    expect((await send('DELETE', `/api/foods/${okra.id}`)).status).toBe(204);
    expect((await listOf(send)).map((f) => f.id)).toEqual([broccoli.id, rice.id]);
    const all = await listOf(send, '?includeArchived=true');
    expect(all.map((f) => f.id)).toEqual([broccoli.id, okra.id, rice.id]);
    expect(all.find((f) => f.id === okra.id)?.archivedAt).not.toBeNull();
  });

  it('archives without deleting, so past plans still name it, and the same food can be added again', async () => {
    const { send, user } = await member('archive@example.test');
    const first = await add(send, per100());
    await send('DELETE', `/api/foods/${first.id}`);
    const [kept] = await t.db
      .select({ archivedAt: food.archivedAt })
      .from(food)
      .where(and(eq(food.id, first.id), eq(food.userId, user.id)));
    expect(kept?.archivedAt).toBeInstanceOf(Date);

    // Archiving again keeps the first time.
    expect((await send('DELETE', `/api/foods/${first.id}`)).status).toBe(204);
    const [still] = await t.db
      .select({ archivedAt: food.archivedAt })
      .from(food)
      .where(eq(food.id, first.id));
    expect(still?.archivedAt).toEqual(kept?.archivedAt);

    const again = await add(send, per100());
    expect(again.id).not.toBe(first.id);
  });

  it('edits values per 100 g, piece weight, keeping days and state', async () => {
    const { send } = await member('edit@example.test');
    const created = await add(send, per100());
    const res = await send('PATCH', `/api/foods/${created.id}`, {
      proteinG: 24,
      pieceWeightG: 120,
      keepsDays: null,
      brand: 'Costco',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ...created,
      proteinG: 24,
      pieceWeightG: 120,
      keepsDays: null,
      brand: 'Costco',
    });
  });

  it('refuses a rename onto another listed food, and an unknown food', async () => {
    const { send } = await member('rename@example.test');
    const chicken = await add(send, per100());
    const rice = await add(send, per100({ name: 'Rice', sourceRef: '01088' }));
    const res = await send('PATCH', `/api/foods/${rice.id}`, { name: 'CHICKEN breast, skinless' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'food_exists', existingFoodId: chicken.id });

    expect((await send('PATCH', `/api/foods/${randomUUID()}`, { name: 'x' })).status).toBe(404);
  });

  it('refuses values above what 100 g can hold', async () => {
    const { send } = await member('edit-bounds@example.test');
    const created = await add(send, per100());
    expect((await send('PATCH', `/api/foods/${created.id}`, { fatG: 101 })).status).toBe(422);
    expect((await send('PATCH', `/api/foods/${created.id}`, { energyKcal: 901 })).status).toBe(422);
  });
});

describe('foods across users (docs/08 §10)', () => {
  it('never lists, edits or archives another user’s food', async () => {
    const owner = await member('owner@example.test');
    const other = await member('other@example.test');
    const theirs = await add(owner.send, per100());

    expect(await listOf(other.send, '?includeArchived=true')).toEqual([]);
    expect((await other.send('PATCH', `/api/foods/${theirs.id}`, { proteinG: 1 })).status).toBe(
      404,
    );
    expect((await other.send('DELETE', `/api/foods/${theirs.id}`)).status).toBe(204);
    expect((await listOf(owner.send))[0]).toEqual(theirs);

    // Their id is a conflict, never their food; their barcode or name is not a duplicate.
    const reused = await other.send('POST', '/api/foods', { ...per100(), id: theirs.id });
    expect(reused.status).toBe(409);
    expect((await reused.json()).code).toBe('id_conflict');
    await add(other.send, per100());
  });

  it('refuses another user’s rotation group as if it did not exist', async () => {
    const owner = await member('group-owner@example.test');
    const other = await member('group-other@example.test');
    const groupId = randomUUID();
    expect(
      (
        await owner.send('POST', '/api/rotation-groups', {
          id: groupId,
          name: 'Starch',
          foodIds: [],
        })
      ).status,
    ).toBe(201);

    const res = await other.send('POST', '/api/foods', per100({ rotationGroupId: groupId }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual([
      { path: 'rotationGroupId', message: 'Not one of your rotation groups' },
    ]);
    const mine = await add(other.send, per100());
    expect(
      (await other.send('PATCH', `/api/foods/${mine.id}`, { rotationGroupId: groupId })).status,
    ).toBe(422);
  });

  it('answers 401 without a session', async () => {
    expect((await t.app.request('/api/foods')).status).toBe(401);
    expect((await t.app.request('/api/reference-foods?q=rice')).status).toBe(401);
    expect((await t.app.request('/api/barcodes/4901234567894')).status).toBe(401);
  });
});

type Reference = {
  code: string;
  name: string;
  nameEn: string | null;
  state: string;
  energyKcal: number;
  proteinG: number;
  existingFoodId: string | null;
};

async function search(send: ReturnType<typeof sender>, q: string) {
  const res = await send('GET', `/api/reference-foods?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  const body: { items: Reference[] } = await res.json();
  return body.items;
}

describe('GET /api/reference-foods', () => {
  it('finds MEXT foods by English words, every word matching, raw first', async () => {
    const { send } = await member('search@example.test');
    const found = await search(send, 'chicken breast skin');
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(20);
    for (const entry of found) expect(entry.nameEn?.toLowerCase()).toMatch(/chicken.*breast/);
    expect(found.find((entry) => entry.code === '11220')).toMatchObject({
      nameEn: 'Chicken, broiler, breast, meat without skin, raw',
      state: 'raw',
      energyKcal: 105,
      proteinG: 23.3,
      existingFoodId: null,
    });
    const states = found.map((entry) => entry.state);
    expect(
      states.indexOf('cooked') === -1 || states.lastIndexOf('raw') < states.indexOf('cooked'),
    ).toBe(true);
  });

  it('finds them by the name as MEXT prints it', async () => {
    const { send } = await member('search-ja@example.test');
    const found = await search(send, 'むね　皮なし 生');
    expect(found.map((entry) => entry.code)).toContain('11220');
    expect(await search(send, 'ブロッコリー')).toContainEqual(
      expect.objectContaining({ code: '06263', state: 'raw' }),
    );
  });

  it('treats % and _ as themselves, and says when nothing matches', async () => {
    const { send } = await member('search-literal@example.test');
    const juices = await search(send, '50%果汁');
    expect(juices.length).toBeGreaterThan(0);
    for (const entry of juices) expect(entry.name).toContain('50%果汁');
    expect(await search(send, '_')).toEqual([]);
    expect(await search(send, 'zzzz')).toEqual([]);
  });

  it('names the food on the caller’s list with that code, and only the caller’s', async () => {
    const owner = await member('search-owner@example.test');
    const other = await member('search-other@example.test');
    const created = await add(owner.send, per100());
    const mine = (await search(owner.send, 'chicken breast')).find((e) => e.code === '11220');
    expect(mine?.existingFoodId).toBe(created.id);
    const theirs = (await search(other.send, 'chicken breast')).find((e) => e.code === '11220');
    expect(theirs?.existingFoodId).toBeNull();
  });

  it('refuses an empty query', async () => {
    const { send } = await member('search-empty@example.test');
    expect((await send('GET', '/api/reference-foods?q=')).status).toBe(400);
    expect((await send('GET', '/api/reference-foods')).status).toBe(400);
  });
});

const candidate = {
  name: 'Rolled oats',
  brand: 'Quaker',
  state: null,
  basis: { kind: 'per_serving' as const, grams: 40 },
  energyKcal: 150,
  proteinG: 5,
  carbG: 27,
  fatG: 3,
  fiberG: 4,
};

describe('GET /api/barcodes/{code}', () => {
  it('keeps liquid barcode values on their volume basis until a member gives grams', async () => {
    const { send } = await member('liquid-barcode@example.test', volumeSource);
    upstreamProduct = {
      product_name: 'Dense drink',
      nutrition_data_per: '100ml',
      nutriments: {
        'energy-kcal_100g': 100,
        proteins_100g: 11,
        carbohydrates_100g: 10,
        fat_100g: 2,
      },
    };
    const res = await send('GET', '/api/barcodes/4901234567894');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidate.basis).toEqual({ kind: 'per_100ml', grams: null });
    expect(body.per100g).toBeNull();

    upstreamProduct = {
      ...upstreamProduct,
      nutrition_data_per: '100g',
      product_quantity_unit: 'ml',
    };
    const packagedVolume = await (await send('GET', '/api/barcodes/4901234567897')).json();
    expect(packagedVolume.candidate.basis).toEqual({ kind: 'per_100ml', grams: null });
    expect(packagedVolume.per100g).toBeNull();

    upstreamProduct = {
      ...upstreamProduct,
      nutrition_data_per: 'serving',
      serving_quantity: 200,
      serving_quantity_unit: 'ml',
      nutriments: {
        'energy-kcal_serving': 130,
        proteins_serving: 7,
      },
    };
    const serving = await (await send('GET', '/api/barcodes/4901234567895')).json();
    expect(serving.candidate.basis).toEqual({ kind: 'per_serving', grams: null });
    expect(serving.per100g).toBeNull();

    upstreamProduct = { ...upstreamProduct, serving_quantity_unit: 'g', product_quantity_unit: 'ml' };
    const weighed = await (await send('GET', '/api/barcodes/4901234567896')).json();
    expect(weighed.candidate.basis).toEqual({ kind: 'per_serving', grams: 200 });
    expect(weighed.per100g.energyKcal).toBe(65);
  });

  it('returns Open Food Facts’ candidate and its values per 100 g, saving nothing', async () => {
    const { send, user } = await member('scan@example.test');
    barcodeAnswer = { kind: 'found', candidate };
    const res = await send('GET', '/api/barcodes/4901234567894');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidate,
      per100g: { energyKcal: 375, proteinG: 12.5, carbG: 67.5, fatG: 7.5, fiberG: 10 },
      existingFoodId: null,
    });
    expect(await t.db.select().from(food).where(eq(food.userId, user.id))).toEqual([]);
  });

  it('returns existingFoodId without asking Open Food Facts when the list has the barcode', async () => {
    const owner = await member('scan-owner@example.test');
    const other = await member('scan-other@example.test');
    const created = await add(
      owner.send,
      per100({ name: 'Oats', source: 'open_food_facts', sourceRef: '4901234567894' }),
    );
    lookups.length = 0;
    const res = await owner.send('GET', '/api/barcodes/4901234567894');
    expect(await res.json()).toEqual({
      candidate: null,
      per100g: null,
      existingFoodId: created.id,
    });
    expect(lookups).toEqual([]);

    // Another user's food with that barcode is not on this list.
    barcodeAnswer = { kind: 'found', candidate };
    expect(
      (await (await other.send('GET', '/api/barcodes/4901234567894')).json()).existingFoodId,
    ).toBeNull();
    expect(lookups).toEqual(['4901234567894']);

    // Archived, it is off the list: the lookup runs again.
    await owner.send('DELETE', `/api/foods/${created.id}`);
    expect(
      (await (await owner.send('GET', '/api/barcodes/4901234567894')).json()).candidate,
    ).toEqual(candidate);
  });

  it.each([
    [{ kind: 'not_found' }, 404, 'not_found'],
    [{ kind: 'rate_limited' }, 429, 'rate_limited'],
    [{ kind: 'failed' }, 502, 'upstream_failed'],
  ] as const)('answers %j as %i %s', async (answer, status, code) => {
    const { send } = await member(`scan-${code}@example.test`);
    barcodeAnswer = answer;
    const res = await send('GET', '/api/barcodes/4901234567894');
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });

  it('refuses what is not a barcode', async () => {
    const { send } = await member('scan-bad@example.test');
    expect((await send('GET', '/api/barcodes/abc')).status).toBe(400);
    expect((await send('GET', '/api/barcodes/1234567')).status).toBe(400);
  });
});

function photo(cookie: string, image: Blob | undefined, app = t) {
  const form = new FormData();
  if (image !== undefined) form.append('image', image, 'label.jpg');
  return app.app.request('/api/label-reads', {
    method: 'POST',
    headers: { cookie, Origin: WEB_ORIGIN },
    body: form,
  });
}

const jpeg = () =>
  new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' });

const read: LabelRead = {
  kind: 'read',
  model: 'claude-haiku-4-5',
  candidate: {
    name: 'サラダチキン プレーン',
    brand: null,
    state: 'cooked',
    basis: { kind: 'per_package', grams: 110 },
    energyKcal: 121,
    proteinG: 26.4,
    carbG: 0.3,
    fatG: 1.5,
    fiberG: null,
  },
};

async function callsToday(userId: string) {
  const rows = await t.db
    .select({ calls: modelCallCount.calls })
    .from(modelCallCount)
    .where(eq(modelCallCount.userId, userId));
  return rows.reduce((sum, row) => sum + row.calls, 0);
}

describe('POST /api/label-reads', () => {
  it('returns the candidate on its basis and per 100 g, sends the photo, and counts the call', async () => {
    const { cookie, user } = await member('label@example.test');
    labelAnswer = read;
    reads.length = 0;
    const res = await photo(cookie, jpeg());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidate: read.candidate,
      per100g: { energyKcal: 110, proteinG: 24, carbG: 0.27, fatG: 1.36, fiberG: null },
      model: 'claude-haiku-4-5',
    });
    expect(reads).toHaveLength(1);
    expect(reads[0]?.mediaType).toBe('image/jpeg');
    expect([...(reads[0]?.data ?? [])]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(await callsToday(user.id)).toBe(1);
    expect(await t.db.select().from(food).where(eq(food.userId, user.id))).toEqual([]);
  });

  it('answers unreadable_label and upstream_failed, each read still counted', async () => {
    const { cookie, user } = await member('label-fail@example.test');
    labelAnswer = { kind: 'unreadable' };
    const unreadable = await photo(cookie, jpeg());
    expect(unreadable.status).toBe(422);
    expect((await unreadable.json()).code).toBe('unreadable_label');

    labelAnswer = { kind: 'failed' };
    const failed = await photo(cookie, jpeg());
    expect(failed.status).toBe(502);
    expect((await failed.json()).code).toBe('upstream_failed');
    expect(await callsToday(user.id)).toBe(2);
  });

  it('answers model_cap_reached once the day’s calls are used up, without calling the model', async () => {
    const { cookie, user } = await member('label-cap@example.test');
    labelAnswer = read;
    for (let n = 0; n < MODEL_CALLS_PER_DAY; n += 1) {
      expect((await photo(cookie, jpeg())).status).toBe(200);
    }
    reads.length = 0;
    const capped = await photo(cookie, jpeg());
    expect(capped.status).toBe(429);
    expect((await capped.json()).code).toBe('model_cap_reached');
    expect(reads).toEqual([]);
    expect(await callsToday(user.id)).toBe(MODEL_CALLS_PER_DAY);

    // The cap is per user.
    const other = await member('label-cap-other@example.test');
    expect((await photo(other.cookie, jpeg())).status).toBe(200);
  });

  it('counts against the day in the profile’s time zone', async () => {
    const { cookie, user, send } = await member('label-zone@example.test');
    expect(
      (await send('PATCH', '/api/me/profile', { timezone: 'Pacific/Kiritimati' })).status,
    ).toBe(200);
    labelAnswer = read;
    await photo(cookie, jpeg());
    const [row] = await t.db
      .select({ day: modelCallCount.day })
      .from(modelCallCount)
      .where(eq(modelCallCount.userId, user.id));
    const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(
      new Date(),
    );
    expect(row?.day).toBe(expected);
  });

  it('refuses no image, another type, and a photo over 4 MB, counting nothing', async () => {
    const { cookie, user } = await member('label-bad@example.test');
    expect((await photo(cookie, undefined)).status).toBe(422);
    const heic = await photo(cookie, new Blob([new Uint8Array([1])], { type: 'image/heic' }));
    expect(heic.status).toBe(422);
    expect((await heic.json()).errors).toEqual([
      { path: 'image', message: 'Send a JPEG, PNG or WebP photo' },
    ]);
    const big = await photo(
      cookie,
      new Blob([new Uint8Array(4 * 1024 * 1024 + 70 * 1024)], { type: 'image/jpeg' }),
    );
    expect(big.status).toBe(413);
    expect((await big.json()).code).toBe('payload_too_large');
    expect(await callsToday(user.id)).toBe(0);
  });

  it('answers upstream_failed and counts nothing while no reader is set up', async () => {
    const { cookie, user } = await member('label-unset@example.test', unset);
    const res = await photo(cookie, jpeg(), unset);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('upstream_failed');
    const rows = await unset.db
      .select()
      .from(modelCallCount)
      .where(eq(modelCallCount.userId, user.id));
    expect(rows).toEqual([]);
  });

  it('answers 401 without a session', async () => {
    expect((await photo('', jpeg())).status).toBe(401);
  });
});

describe('what the food routes log (docs/03 §7)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs ids and codes only: no food name, value, search word, barcode or photo', async () => {
    const errors = vi.spyOn(console, 'error');
    const { cookie, send } = await member('logged@example.test', logged);
    logLines.length = 0;
    const made = await add(
      send,
      per100({ name: 'Kinpira gobo', brand: 'Mitsukan', energyKcal: 471.9, sourceRef: null }),
    );
    expect((await send('PATCH', `/api/foods/${made.id}`, { proteinG: 31.7 })).status).toBe(200);
    expect((await send('GET', '/api/reference-foods?q=natto')).status).toBe(200);
    barcodeAnswer = { kind: 'found', candidate };
    expect((await send('GET', '/api/barcodes/4909876543210')).status).toBe(200);
    labelAnswer = read;
    expect((await photo(cookie, jpeg(), logged)).status).toBe(200);
    expect((await send('DELETE', `/api/foods/${made.id}`)).status).toBe(204);

    expect(logLines).toHaveLength(6);
    for (const line of logLines) {
      expect(Object.keys(JSON.parse(line)).toSorted()).toEqual([
        'method',
        'ms',
        'requestId',
        'route',
        'status',
      ]);
    }
    const all = logLines.join('\n');
    for (const value of [
      'Kinpira',
      'Mitsukan',
      '471.9',
      '31.7',
      'natto',
      '4909876543210',
      'Rolled oats',
      'サラダチキン',
    ]) {
      expect(all).not.toContain(value);
    }
    expect(errors).not.toHaveBeenCalled();
  });
});
