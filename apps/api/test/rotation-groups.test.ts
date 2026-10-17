import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sender } from './account-fixture';
import { useTestApp } from './harness';

// Rotation groups (S12, docs/07 §4, issue #78): foods that stand in for each other, okra ↔
// broccoli, rice ↔ potato. A food is in one group at most; deleting a group keeps its foods. Each
// route's cross-user case (docs/08 §10).
const t = useTestApp();

type Group = { id: string; name: string; foodIds: string[] };
type Send = ReturnType<typeof sender>;

async function member(email: string) {
  const { cookie } = await t.createSignedInUser(email);
  return sender(t, cookie);
}

async function addFood(send: Send, name: string) {
  const res = await send('POST', '/api/foods', {
    id: randomUUID(),
    name,
    state: 'raw',
    basis: { kind: 'per_100g', grams: null },
    energyKcal: 100,
    proteinG: 2,
    carbG: 20,
    fatG: 0.5,
    fiberG: 1,
    source: 'manual',
  });
  expect(res.status).toBe(201);
  const food: { id: string; rotationGroupId: string | null } = await res.json();
  return food.id;
}

async function groups(send: Send) {
  const res = await send('GET', '/api/rotation-groups');
  expect(res.status).toBe(200);
  const body: { items: Group[] } = await res.json();
  return body.items;
}

async function foodGroupOf(send: Send, id: string) {
  const res = await send('GET', '/api/foods?includeArchived=true');
  const body: { items: { id: string; rotationGroupId: string | null }[] } = await res.json();
  return body.items.find((food) => food.id === id)?.rotationGroupId;
}

describe('rotation groups', () => {
  it('groups two foods as alternatives, and a repeat returns the stored group', async () => {
    const send = await member('groups@example.test');
    const rice = await addFood(send, 'White rice');
    const potato = await addFood(send, 'Potato, peeled');
    const body = { id: randomUUID(), name: 'Starch', foodIds: [rice, potato] };

    const created = await send('POST', '/api/rotation-groups', body);
    expect(created.status).toBe(201);
    // Foods by name.
    expect(await created.json()).toEqual({ id: body.id, name: 'Starch', foodIds: [potato, rice] });
    expect(await foodGroupOf(send, rice)).toBe(body.id);

    const again = await send('POST', '/api/rotation-groups', body);
    expect(again.status).toBe(200);
    const conflict = await send('POST', '/api/rotation-groups', { ...body, name: 'Carbs' });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('id_conflict');
  });

  it('lists groups by name, and moves a food from one group to another', async () => {
    const send = await member('move@example.test');
    const okra = await addFood(send, 'Okra');
    const broccoli = await addFood(send, 'Broccoli');
    const green = randomUUID();
    const other = randomUUID();
    await send('POST', '/api/rotation-groups', {
      id: green,
      name: 'Green vegetable',
      foodIds: [okra],
    });
    await send('POST', '/api/rotation-groups', { id: other, name: 'A side', foodIds: [broccoli] });

    const res = await send('PATCH', `/api/rotation-groups/${green}`, { foodIds: [okra, broccoli] });
    expect(res.status).toBe(200);
    expect(await groups(send)).toEqual([
      { id: other, name: 'A side', foodIds: [] },
      { id: green, name: 'Green vegetable', foodIds: [broccoli, okra] },
    ]);
  });

  it('removes a food from a group, keeps it on the list, and renames the group', async () => {
    const send = await member('remove@example.test');
    const okra = await addFood(send, 'Okra');
    const broccoli = await addFood(send, 'Broccoli');
    const id = randomUUID();
    await send('POST', '/api/rotation-groups', { id, name: 'Greens', foodIds: [okra, broccoli] });

    const res = await send('PATCH', `/api/rotation-groups/${id}`, {
      name: 'Green vegetable',
      foodIds: [broccoli],
    });
    expect(await res.json()).toEqual({ id, name: 'Green vegetable', foodIds: [broccoli] });
    expect(await foodGroupOf(send, okra)).toBeNull();
  });

  it('deletes a group and keeps its foods, ungrouped', async () => {
    const send = await member('delete@example.test');
    const rice = await addFood(send, 'Rice');
    const id = randomUUID();
    await send('POST', '/api/rotation-groups', { id, name: 'Starch', foodIds: [rice] });
    expect((await send('DELETE', `/api/rotation-groups/${id}`)).status).toBe(204);
    expect(await groups(send)).toEqual([]);
    expect(await foodGroupOf(send, rice)).toBeNull();
    expect((await send('DELETE', `/api/rotation-groups/${id}`)).status).toBe(204);
  });

  it('leaves an archived food out of its group’s members', async () => {
    const send = await member('archived@example.test');
    const rice = await addFood(send, 'Rice');
    const potato = await addFood(send, 'Potato');
    const id = randomUUID();
    await send('POST', '/api/rotation-groups', { id, name: 'Starch', foodIds: [rice, potato] });
    await send('DELETE', `/api/foods/${rice}`);
    expect((await groups(send))[0]?.foodIds).toEqual([potato]);
    // An archived food cannot be put in a group.
    const res = await send('PATCH', `/api/rotation-groups/${id}`, { foodIds: [potato, rice] });
    expect(res.status).toBe(422);
  });

  it('refuses a food listed twice', async () => {
    const send = await member('twice@example.test');
    const rice = await addFood(send, 'Rice');
    const res = await send('POST', '/api/rotation-groups', {
      id: randomUUID(),
      name: 'Starch',
      foodIds: [rice, rice],
    });
    expect(res.status).toBe(422);
  });
});

describe('rotation groups across users (docs/08 §10)', () => {
  it('never lists, edits or deletes another user’s group, nor groups their foods', async () => {
    const owner = await member('group-owner@example.test');
    const other = await member('group-other@example.test');
    const rice = await addFood(owner, 'Rice');
    const id = randomUUID();
    await owner('POST', '/api/rotation-groups', { id, name: 'Starch', foodIds: [rice] });

    expect(await groups(other)).toEqual([]);
    expect((await other('PATCH', `/api/rotation-groups/${id}`, { name: 'Mine' })).status).toBe(404);
    expect((await other('DELETE', `/api/rotation-groups/${id}`)).status).toBe(204);
    expect(await groups(owner)).toEqual([{ id, name: 'Starch', foodIds: [rice] }]);

    const theirFood = await other('POST', '/api/rotation-groups', {
      id: randomUUID(),
      name: 'Stolen',
      foodIds: [rice],
    });
    expect(theirFood.status).toBe(422);
    expect((await theirFood.json()).errors).toEqual([
      { path: 'foodIds.0', message: 'Not a food on your list' },
    ]);
    expect(await foodGroupOf(owner, rice)).toBe(id);

    const reused = await other('POST', '/api/rotation-groups', { id, name: 'Starch', foodIds: [] });
    expect(reused.status).toBe(409);
  });

  it('answers 401 without a session', async () => {
    expect((await t.app.request('/api/rotation-groups')).status).toBe(401);
  });
});
