import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { Shortfall } from '../domain/planner.js';
import { batchYield, cookedPer100g } from '../domain/prep.js';
import { newestBatches } from './batches.js';
import type { Database, Queryable, Transaction } from './connection.js';
import { food, planDay, planMeal, planMealItem, referenceFood } from './schema.js';

/** The five values per 100 g a plan item carries. */
export type Per100g = {
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
};

export type PlanItem = {
  id: string;
  foodId: string | null;
  name: string;
  plannedGrams: number | null;
  actualGrams: number | null;
  pieceCount: number | null;
  /** The grams are a cooked weight (S16). */
  cooked: boolean;
  /** A cooked weight with no batch yield to convert by (docs/02, Empty states). */
  approximate: boolean;
  /** A batch-cooked food the MEXT table has no cooked values for: planned raw (S16). */
  noCookedMatch: boolean;
  /** The batch whose yield gave the cooked values (S13). */
  batchId: string | null;
  per100g: Per100g;
};

export type PlanMealStatus = 'planned' | 'as_planned' | 'adjusted' | 'replaced' | 'skipped';

export type PlanMeal = {
  id: string;
  position: number;
  plannedTime: string;
  label: string | null;
  isPreTraining: boolean;
  isPostTraining: boolean;
  status: PlanMealStatus;
  confirmedAt: Date | null;
  items: PlanItem[];
};

export type StoredPlanDay = {
  id: string;
  date: string;
  dayType: 'training' | 'rest';
  goalPhaseId: string | null;
  targets: { energyKcal: number; proteinG: number; carbG: number; fatG: number };
  shortfalls: Shortfall[];
  generatedAt: Date;
  meals: PlanMeal[];
};

/** A day the planner made, to be written in place of any unconfirmed copy of it. */
export type NewPlanDay = Omit<StoredPlanDay, 'id' | 'generatedAt' | 'meals'> & {
  meals: (Omit<PlanMeal, 'id' | 'status' | 'confirmedAt' | 'items'> & {
    items: Omit<PlanItem, 'id' | 'actualGrams'>[];
  })[];
};

const hhmm = (time: string) => time.slice(0, 5);

/** The plan days in a range of local dates, both included, oldest first, meals and items whole. */
export async function listPlanDays(
  db: Queryable,
  userId: string,
  range: { from: string; to: string },
): Promise<StoredPlanDay[]> {
  const days = await db
    .select({
      id: planDay.id,
      date: planDay.planDate,
      dayType: planDay.dayType,
      goalPhaseId: planDay.goalPhaseId,
      energyKcal: planDay.targetKcal,
      proteinG: planDay.targetProteinG,
      carbG: planDay.targetCarbG,
      fatG: planDay.targetFatG,
      shortfalls: planDay.shortfalls,
      generatedAt: planDay.generatedAt,
    })
    .from(planDay)
    .where(
      and(
        eq(planDay.userId, userId),
        gte(planDay.planDate, range.from),
        lte(planDay.planDate, range.to),
      ),
    )
    .orderBy(asc(planDay.planDate));
  return withMeals(db, days);
}

async function withMeals(
  db: Queryable,
  days: {
    id: string;
    date: string;
    dayType: 'training' | 'rest';
    goalPhaseId: string | null;
    energyKcal: number;
    proteinG: number;
    carbG: number;
    fatG: number;
    shortfalls: unknown;
    generatedAt: Date;
  }[],
): Promise<StoredPlanDay[]> {
  if (days.length === 0) return [];
  const meals = await db
    .select({
      id: planMeal.id,
      planDayId: planMeal.planDayId,
      position: planMeal.position,
      plannedTime: planMeal.plannedTime,
      label: planMeal.label,
      isPreTraining: planMeal.isPreTraining,
      isPostTraining: planMeal.isPostTraining,
      status: planMeal.status,
      confirmedAt: planMeal.confirmedAt,
    })
    .from(planMeal)
    .where(
      inArray(
        planMeal.planDayId,
        days.map((day) => day.id),
      ),
    )
    .orderBy(asc(planMeal.position), asc(planMeal.id));
  const items =
    meals.length === 0
      ? []
      : await db
          .select({
            id: planMealItem.id,
            planMealId: planMealItem.planMealId,
            foodId: planMealItem.foodId,
            name: planMealItem.name,
            plannedGrams: planMealItem.plannedGrams,
            actualGrams: planMealItem.actualGrams,
            pieceCount: planMealItem.pieceCount,
            cooked: planMealItem.cooked,
            approximate: planMealItem.approximate,
            noCookedMatch: planMealItem.noCookedMatch,
            batchId: planMealItem.batchId,
            energyKcal: planMealItem.energyKcalPer100g,
            proteinG: planMealItem.proteinGPer100g,
            carbG: planMealItem.carbGPer100g,
            fatG: planMealItem.fatGPer100g,
            fiberG: planMealItem.fiberGPer100g,
          })
          .from(planMealItem)
          .where(
            inArray(
              planMealItem.planMealId,
              meals.map((meal) => meal.id),
            ),
          )
          .orderBy(asc(planMealItem.id));
  return days.map(({ energyKcal, proteinG, carbG, fatG, shortfalls, ...day }) => ({
    ...day,
    targets: { energyKcal, proteinG, carbG, fatG },
    // Written by the planner only, in its own shape.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the column holds Shortfall[]
    shortfalls: shortfalls as Shortfall[],
    meals: meals
      .filter((meal) => meal.planDayId === day.id)
      .map((meal) => ({
        id: meal.id,
        position: meal.position,
        plannedTime: hhmm(meal.plannedTime),
        label: meal.label,
        isPreTraining: meal.isPreTraining,
        isPostTraining: meal.isPostTraining,
        status: meal.status,
        confirmedAt: meal.confirmedAt,
        items: items
          .filter((item) => item.planMealId === meal.id)
          .map((item) => ({
            id: item.id,
            foodId: item.foodId,
            name: item.name,
            plannedGrams: item.plannedGrams,
            actualGrams: item.actualGrams,
            pieceCount: item.pieceCount,
            cooked: item.cooked,
            approximate: item.approximate,
            noCookedMatch: item.noCookedMatch,
            batchId: item.batchId,
            per100g: {
              energyKcal: item.energyKcal,
              proteinG: item.proteinG,
              carbG: item.carbG,
              fatG: item.fatG,
              fiberG: item.fiberG,
            },
          })),
      })),
  }));
}

/** The dates in the range with any meal confirmed: those days are never generated again (S16). */
export async function confirmedDates(
  db: Queryable,
  userId: string,
  range: { from: string; to: string },
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ date: planDay.planDate })
    .from(planDay)
    .innerJoin(planMeal, eq(planMeal.planDayId, planDay.id))
    .where(
      and(
        eq(planDay.userId, userId),
        gte(planDay.planDate, range.from),
        lte(planDay.planDate, range.to),
        ne(planMeal.status, 'planned'),
      ),
    );
  return new Set(rows.map((row) => row.date));
}

/**
 * Runs `work` in one transaction that holds the user's plan lock, so two generations at once run
 * one after the other: each reads its inputs and writes its days with no other in between.
 */
export async function withPlanLock<T>(
  db: Database,
  userId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('plan_day'), hashtext(${userId}))`);
    return work(tx);
  });
}

/** Writes generated days in place of their unconfirmed copies, all but the dates `kept`. */
export async function replacePlanDays(
  tx: Transaction,
  userId: string,
  days: NewPlanDay[],
  kept: Set<string>,
): Promise<void> {
  const written = days.filter((day) => !kept.has(day.date));
  if (written.length === 0) return;
  await tx.delete(planDay).where(
    and(
      eq(planDay.userId, userId),
      inArray(
        planDay.planDate,
        written.map((day) => day.date),
      ),
    ),
  );
  for (const day of written) {
    const [row] = await tx
      .insert(planDay)
      .values({
        userId,
        planDate: day.date,
        dayType: day.dayType,
        goalPhaseId: day.goalPhaseId,
        targetKcal: day.targets.energyKcal,
        targetProteinG: day.targets.proteinG,
        targetCarbG: day.targets.carbG,
        targetFatG: day.targets.fatG,
        shortfalls: day.shortfalls,
      })
      .returning({ id: planDay.id });
    if (row === undefined) throw new Error('plan day insert returned no row');
    if (day.meals.length === 0) continue;
    const meals = await tx
      .insert(planMeal)
      .values(
        day.meals.map((meal) => ({
          planDayId: row.id,
          position: meal.position,
          plannedTime: meal.plannedTime,
          label: meal.label,
          isPreTraining: meal.isPreTraining,
          isPostTraining: meal.isPostTraining,
        })),
      )
      .returning({ id: planMeal.id, position: planMeal.position });
    const items = day.meals.flatMap((meal) => {
      const stored = meals.find((each) => each.position === meal.position);
      if (stored === undefined) return [];
      return meal.items.map((item) => ({
        planMealId: stored.id,
        foodId: item.foodId,
        name: item.name,
        plannedGrams: item.plannedGrams,
        pieceCount: item.pieceCount,
        cooked: item.cooked,
        approximate: item.approximate,
        noCookedMatch: item.noCookedMatch,
        batchId: item.batchId,
        energyKcalPer100g: item.per100g.energyKcal,
        proteinGPer100g: item.per100g.proteinG,
        carbGPer100g: item.per100g.carbG,
        fatGPer100g: item.per100g.fatG,
        fiberGPer100g: item.per100g.fiberG,
      }));
    });
    if (items.length > 0) await tx.insert(planMealItem).values(items);
  }
}

/** A food as the planner reads it: its values per 100 g of the weight the plan gives. */
export type PlanFood = {
  id: string;
  name: string;
  per100g: Per100g;
  pieceWeightG: number | null;
  rotationGroupId: string | null;
  /** How many days a cooked batch keeps; null for a food not batch-cooked (S13). */
  keepsDays: number | null;
  cooked: boolean;
  approximate: boolean;
  noCookedMatch: boolean;
  /** The batch whose yield gave the cooked values. */
  batchId: string | null;
};

/**
 * MEXT's cooked counterparts of a raw name, in the order tried: boiled, simmered, steamed, grilled,
 * and for grain, cooked rice (めし) in place of the dry grain (穀粒).
 */
export function cookedNames(raw: string): string[] {
  const names: string[] = [];
  if (raw.endsWith('　生')) {
    const stem = raw.slice(0, -'　生'.length);
    names.push(...['ゆで', '水煮', '蒸し', '焼き'].map((word) => `${stem}　${word}`));
  }
  if (raw.includes('穀粒')) names.push(raw.replace('穀粒', 'めし'));
  return names;
}

/**
 * The unarchived foods, as the plan weighs them (S16). A food stored cooked is planned cooked. One
 * stored raw and batch-cooked (`keeps_days` set) is planned in cooked weight, by its raw values and
 * the yield of its newest batch (S13). With no batch recorded, it is planned by the MEXT table's
 * cooked values for the same food, marked approximate (docs/02, Empty states); with no cooked
 * counterpart either, raw by its own values, and says so: raw values are never presented as cooked
 * (docs/06, 2026-10-18). Any other food is planned as it is weighed, raw.
 */
export async function planFoods(db: Queryable, userId: string): Promise<PlanFood[]> {
  const foods = await db
    .select({
      id: food.id,
      name: food.name,
      state: food.state,
      energyKcal: food.energyKcal,
      proteinG: food.proteinG,
      carbG: food.carbG,
      fatG: food.fatG,
      fiberG: food.fiberG,
      pieceWeightG: food.pieceWeightG,
      keepsDays: food.keepsDays,
      source: food.source,
      sourceRef: food.sourceRef,
      rotationGroupId: food.rotationGroupId,
    })
    .from(food)
    .where(and(eq(food.userId, userId), isNull(food.archivedAt)))
    .orderBy(asc(food.id));

  const batches = new Map((await newestBatches(db, userId)).map((batch) => [batch.foodId, batch]));
  const batchCooked = foods.filter(
    (each) => each.state === 'raw' && each.keepsDays !== null && !batches.has(each.id),
  );
  const codes = batchCooked
    .filter((each) => each.source === 'mext' && each.sourceRef !== null)
    .map((each) => each.sourceRef ?? '');
  const raws =
    codes.length === 0
      ? []
      : await db
          .select({
            code: referenceFood.code,
            name: referenceFood.name,
            group: referenceFood.foodGroup,
          })
          .from(referenceFood)
          .where(inArray(referenceFood.code, codes));
  const wanted = raws.flatMap((raw) => cookedNames(raw.name));
  const cooked =
    wanted.length === 0
      ? []
      : await db
          .select({
            name: referenceFood.name,
            group: referenceFood.foodGroup,
            energyKcal: referenceFood.energyKcal,
            proteinG: referenceFood.proteinG,
            carbG: referenceFood.carbG,
            fatG: referenceFood.fatG,
            fiberG: referenceFood.fiberG,
          })
          .from(referenceFood)
          .where(inArray(referenceFood.name, wanted));

  return foods.map((each) => {
    const own = {
      energyKcal: each.energyKcal,
      proteinG: each.proteinG,
      carbG: each.carbG,
      fatG: each.fatG,
      fiberG: each.fiberG,
    };
    const base = {
      id: each.id,
      name: each.name,
      pieceWeightG: each.pieceWeightG,
      rotationGroupId: each.rotationGroupId,
      keepsDays: each.keepsDays,
    };
    const asWeighed = { per100g: own, approximate: false, noCookedMatch: false, batchId: null };
    if (each.state === 'cooked') return { ...base, ...asWeighed, cooked: true };
    if (each.keepsDays === null) return { ...base, ...asWeighed, cooked: false };
    const batch = batches.get(each.id);
    if (batch !== undefined) {
      return {
        ...base,
        per100g: cookedPer100g(own, batchYield(batch)),
        cooked: true,
        approximate: false,
        noCookedMatch: false,
        batchId: batch.id,
      };
    }
    const raw = raws.find((row) => each.source === 'mext' && row.code === each.sourceRef);
    const match =
      raw === undefined
        ? undefined
        : cookedNames(raw.name)
            .map((name) => cooked.find((row) => row.name === name && row.group === raw.group))
            .find((row) => row !== undefined);
    if (match === undefined) return { ...base, ...asWeighed, cooked: false, noCookedMatch: true };
    const per100g = {
      energyKcal: match.energyKcal,
      proteinG: match.proteinG,
      carbG: match.carbG,
      fatG: match.fatG,
      fiberG: match.fiberG,
    };
    return {
      ...base,
      per100g,
      cooked: true,
      approximate: true,
      noCookedMatch: false,
      batchId: null,
    };
  });
}

/** The export's `planDays` section: by date, a page at a time, meals and items nested. */
export async function exportPlanDays(
  db: Database,
  userId: string,
  page: { limit: number; after?: { date: string } | undefined },
): Promise<{ items: StoredPlanDay[]; next: { date: string } | null }> {
  const days = await db
    .select({
      id: planDay.id,
      date: planDay.planDate,
      dayType: planDay.dayType,
      goalPhaseId: planDay.goalPhaseId,
      energyKcal: planDay.targetKcal,
      proteinG: planDay.targetProteinG,
      carbG: planDay.targetCarbG,
      fatG: planDay.targetFatG,
      shortfalls: planDay.shortfalls,
      generatedAt: planDay.generatedAt,
    })
    .from(planDay)
    .where(
      and(
        eq(planDay.userId, userId),
        page.after === undefined ? undefined : sql`${planDay.planDate} > ${page.after.date}::date`,
      ),
    )
    .orderBy(asc(planDay.planDate))
    .limit(page.limit + 1);
  const items = await withMeals(db, days.slice(0, page.limit));
  const last = items.at(-1);
  return {
    items,
    next: days.length > page.limit && last !== undefined ? { date: last.date } : null,
  };
}
