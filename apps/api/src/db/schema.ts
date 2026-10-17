// The schema, as Drizzle tables (docs/04). drizzle-kit generates each migration's SQL from the
// difference between this file and the last snapshot in migrations/meta (`pnpm db:generate`); the
// committed SQL is what changes a database. What Drizzle cannot express (grants, functions, the
// expression index on exercise names, seed rows) lives in custom migrations beside it (docs/12 §3).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema.js';

export * from './auth-schema.js';

const instant = (name: string) => timestamp(name, { withTimezone: true });

// Every id the server makes itself is a UUIDv7 from Postgres 18 (docs/04, Conventions).
const id = () =>
  uuid('id')
    .notNull()
    .default(sql`uuidv7()`)
    .primaryKey();

const timestamps = {
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
};

/** One Google email allowed to sign in (docs/08 §1). */
export const invite = pgTable(
  'invite',
  {
    id: id(),
    email: text('email').notNull(),
    invitedByUserId: uuid('invited_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    revokedAt: instant('revoked_at'),
    ...timestamps,
  },
  (t) => [
    unique('invite_email_key').on(t.email),
    check('invite_email_check', sql`${t.email} = lower(${t.email})`),
  ],
);

/**
 * Who did what to access and accounts (docs/13 §7). Append-only; no FKs, so a row outlives the
 * account it names. The app role's UPDATE and DELETE are revoked in a custom migration.
 */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: id(),
    occurredAt: instant('occurred_at').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    detail: jsonb('detail'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('audit_event_actor_user_id_occurred_at_idx').on(
      t.actorUserId,
      t.occurredAt.desc().nullsFirst(),
    ),
    index('audit_event_occurred_at_idx').on(t.occurredAt),
    check(
      'audit_event_action_check',
      sql`${t.action} IN ('sign_in', 'sign_out', 'invite_created', 'access_revoked', 'access_restored', 'ingest_token_created', 'ingest_token_revoked', 'account_deleted', 'admin_action')`,
    ),
  ],
);

/**
 * One row per user, made by the first profile save. The time zone is the day boundary local dates
 * are read against; the other formula inputs wait for their readers in M2. `weight_unit` is the
 * display preference decided 2026-09-23 (docs/06): weights are stored in kg whatever it says.
 */
export const userProfile = pgTable(
  'user_profile',
  {
    userId: uuid('user_id')
      .notNull()
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('Asia/Tokyo'),
    heightCm: numeric('height_cm', { precision: 5, scale: 1, mode: 'number' }),
    sex: text('sex', { enum: ['male', 'female'] }),
    // A local date, read as its 'YYYY-MM-DD' text so it never passes through a JavaScript Date.
    birthDate: date('birth_date', { mode: 'string' }),
    trainingWeekdays: smallint('training_weekdays')
      .array()
      .notNull()
      .default(sql`'{}'`),
    weightUnit: text('weight_unit', { enum: ['kg', 'lb'] })
      .notNull()
      .default('kg'),
    ...timestamps,
  },
  (t) => [
    check('user_profile_sex_check', sql`${t.sex} IN ('male', 'female')`),
    check('user_profile_weight_unit_check', sql`${t.weightUnit} IN ('kg', 'lb')`),
  ],
);

export const equipmentValues = [
  'barbell',
  'dumbbell',
  'machine_plate',
  'machine_stack',
  'cable',
  'bodyweight',
  'other',
] as const;

/** The one muscle group an exercise is filed under in the library and the picker (docs/04). */
export const muscleGroupValues = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
] as const;

/**
 * Seeded (`owner_user_id` IS NULL) or one user's own (S8). The equipment values are a
 * load-increment taxonomy (docs/06, 2026-09-23). The unique index on `(owner_user_id, lower(name))
 * NULLS NOT DISTINCT` is in a custom migration: Drizzle's index builder has no NULLS NOT DISTINCT.
 * `muscle_group` and `aliases` are set on every seeded row; a custom one may have neither
 * (docs/06, 2026-10-08). `secondary_muscle_groups` are the groups it also trains, where a set
 * counts half (issue #50): reviewed on every seeded row, null on a custom one left without.
 */
export const exercise = pgTable(
  'exercise',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    equipment: text('equipment', { enum: equipmentValues }).notNull(),
    defaultIncrementKg: numeric('default_increment_kg', { precision: 5, scale: 2, mode: 'number' })
      .notNull()
      .default(2.5),
    defaultRestSeconds: integer('default_rest_seconds').notNull().default(120),
    defaultRepLow: smallint('default_rep_low').notNull().default(6),
    defaultRepHigh: smallint('default_rep_high').notNull().default(10),
    muscleGroup: text('muscle_group', { enum: muscleGroupValues }),
    aliases: text('aliases').array(),
    secondaryMuscleGroups: text('secondary_muscle_groups', { enum: muscleGroupValues }).array(),
    ...timestamps,
  },
  (t) => [
    index('exercise_owner_user_id_idx').on(t.ownerUserId),
    check(
      'exercise_muscle_group_check',
      sql`${t.muscleGroup} IN ('chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core')`,
    ),
    check(
      'exercise_secondary_muscle_groups_check',
      sql`${t.secondaryMuscleGroups} <@ ARRAY['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core']::text[] AND NOT (${t.muscleGroup} = ANY(${t.secondaryMuscleGroups}))`,
    ),
    check(
      'exercise_equipment_check',
      sql`${t.equipment} IN ('barbell', 'dumbbell', 'machine_plate', 'machine_stack', 'cable', 'bodyweight', 'other')`,
    ),
    check('exercise_rep_range_check', sql`${t.defaultRepLow} <= ${t.defaultRepHigh}`),
  ],
);

/** One user's overrides for one exercise; absent means the exercise defaults. */
export const exerciseSetting = pgTable(
  'exercise_setting',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercise.id, { onDelete: 'cascade' }),
    incrementKg: numeric('increment_kg', { precision: 5, scale: 2, mode: 'number' }),
    restSeconds: integer('rest_seconds'),
    repLow: smallint('rep_low'),
    repHigh: smallint('rep_high'),
    hiddenAt: instant('hidden_at'),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: 'exercise_setting_pkey', columns: [t.userId, t.exerciseId] }),
    check(
      'exercise_setting_rep_range_check',
      sql`${t.repLow} IS NULL OR ${t.repHigh} IS NULL OR ${t.repLow} <= ${t.repHigh}`,
    ),
  ],
);

/** One saved workout, like "Push A" (S4). Hard delete; past workouts keep their name (docs/04). */
export const routine = pgTable(
  'routine',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('routine_user_id_position_idx').on(t.userId, t.position)],
);

/**
 * One exercise slot in a routine. `position` is not unique, so a reorder never collides mid-update;
 * ties break on the time-ordered `id`. The FK to `exercise` is `DEFERRABLE INITIALLY DEFERRED`
 * (docs/04), which Drizzle cannot express, so it is added in a custom migration.
 */
export const routineExercise = pgTable(
  'routine_exercise',
  {
    id: id(),
    routineId: uuid('routine_id')
      .notNull()
      .references(() => routine.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id').notNull(),
    position: integer('position').notNull(),
    targetSets: smallint('target_sets').notNull().default(3),
    repLow: smallint('rep_low'),
    repHigh: smallint('rep_high'),
    ...timestamps,
  },
  (t) => [
    index('routine_exercise_routine_id_position_idx').on(t.routineId, t.position),
    index('routine_exercise_exercise_id_idx').on(t.exerciseId),
    check('routine_exercise_target_sets_check', sql`${t.targetSets} > 0`),
    check(
      'routine_exercise_rep_range_check',
      sql`${t.repLow} IS NULL OR ${t.repHigh} IS NULL OR ${t.repLow} <= ${t.repHigh}`,
    ),
  ],
);

/**
 * One visit to the gym (docs/04 `workout`). The id is made on the phone and the row arrives only
 * through the sync batch (docs/07 §3.4), guarded by the phone's `client_updated_at`.
 */
export const workout = pgTable(
  'workout',
  {
    id: uuid('id').notNull().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    routineId: uuid('routine_id').references(() => routine.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    startedAt: instant('started_at').notNull(),
    endedAt: instant('ended_at'),
    note: text('note'),
    clientUpdatedAt: instant('client_updated_at').notNull(),
    ...timestamps,
  },
  (t) => [index('workout_user_id_started_at_idx').on(t.userId, t.startedAt.desc())],
);

/**
 * One exercise inside one workout, with the rep range, increment and target sets resolved and
 * copied at start (docs/04). The FK to `exercise` is deferred like `routine_exercise`'s, so it is
 * added in a custom migration. `routine_exercise_id` names the routine slot it was started from and
 * has no FK: saving a routine deletes and re-inserts its slots under the same ids, which would
 * clear it. Last time reads it only where the slot still exists.
 */
export const workoutExercise = pgTable(
  'workout_exercise',
  {
    id: uuid('id').notNull().primaryKey(),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workout.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id').notNull(),
    routineExerciseId: uuid('routine_exercise_id'),
    position: integer('position').notNull(),
    targetSets: smallint('target_sets'),
    repLow: smallint('rep_low').notNull(),
    repHigh: smallint('rep_high').notNull(),
    incrementKg: numeric('increment_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    clientUpdatedAt: instant('client_updated_at').notNull(),
    ...timestamps,
  },
  (t) => [
    index('workout_exercise_workout_id_position_idx').on(t.workoutId, t.position),
    index('workout_exercise_exercise_id_idx').on(t.exerciseId),
    check(
      'workout_exercise_target_sets_check',
      sql`${t.targetSets} IS NULL OR ${t.targetSets} > 0`,
    ),
    check('workout_exercise_rep_range_check', sql`${t.repLow} <= ${t.repHigh}`),
  ],
);

/**
 * One logged set (S1). `position` counts warm-ups too and is never renumbered; the number on screen
 * is derived (docs/04 `set`).
 */
export const set = pgTable(
  'set',
  {
    id: uuid('id').notNull().primaryKey(),
    workoutExerciseId: uuid('workout_exercise_id')
      .notNull()
      .references(() => workoutExercise.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    reps: smallint('reps').notNull(),
    rir: smallint('rir'),
    rpe: numeric('rpe', { precision: 3, scale: 1, mode: 'number' }),
    isWarmup: boolean('is_warmup').notNull().default(false),
    performedAt: instant('performed_at').notNull(),
    clientUpdatedAt: instant('client_updated_at').notNull(),
    ...timestamps,
  },
  (t) => [
    index('set_workout_exercise_id_position_idx').on(t.workoutExerciseId, t.position),
    check('set_reps_check', sql`${t.reps} > 0`),
    check('set_weight_kg_check', sql`${t.weightKg} >= 0`),
    check('set_rir_check', sql`${t.rir} IS NULL OR ${t.rir} BETWEEN 0 AND 10`),
    check('set_rpe_check', sql`${t.rpe} IS NULL OR ${t.rpe} BETWEEN 1 AND 10`),
    check('set_effort_check', sql`${t.rir} IS NULL OR ${t.rpe} IS NULL`),
  ],
);

/**
 * The id of a `workout`, `workout_exercise` or `set` deleted through sync, kept so a stale copy
 * arriving later is not inserted again (docs/04 `sync_tombstone`). The id is the deleted row's own.
 * No `updated_at`: a tombstone is never updated.
 */
export const syncTombstone = pgTable(
  'sync_tombstone',
  {
    id: uuid('id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tableName: text('table_name').notNull(),
    deletedAt: instant('deleted_at').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index('sync_tombstone_created_at_idx').on(t.createdAt),
    check(
      'sync_tombstone_table_name_check',
      sql`${t.tableName} IN ('workout', 'workout_exercise', 'set')`,
    ),
  ],
);

/**
 * One reading from the scale, or one typed by hand (S11; docs/04 `body_measurement`). Typed rows
 * carry the device's UUIDv7. The day's weight and the trend are derived in `domain/weight.ts`,
 * never stored. A reading from Apple Health is deleted there, not here, so the API refuses it.
 */
export const bodyMeasurement = pgTable(
  'body_measurement',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    measuredAt: instant('measured_at').notNull(),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    bodyFatPct: numeric('body_fat_pct', { precision: 4, scale: 1, mode: 'number' }),
    source: text('source', { enum: ['apple_health', 'manual'] }).notNull(),
    externalId: text('external_id'),
    ...timestamps,
  },
  (t) => [
    unique('body_measurement_user_id_source_measured_at_key').on(t.userId, t.source, t.measuredAt),
    index('body_measurement_user_id_measured_at_idx').on(t.userId, t.measuredAt.desc()),
    check('body_measurement_source_check', sql`${t.source} IN ('apple_health', 'manual')`),
  ],
);

/**
 * The MEXT catalogue, 日本食品標準成分表（八訂）増補2023年 (S12, docs/04). Shared and read-only: a pick
 * copies its values into a new `food`. Seeded by a generated migration (seed/mext.ts); its name
 * search index uses pg_trgm, in a custom migration.
 */
export const referenceFood = pgTable(
  'reference_food',
  {
    code: text('code').notNull().primaryKey(),
    name: text('name').notNull(),
    // The 2015 English table's name for the same food number; null for a food added since.
    nameEn: text('name_en'),
    foodGroup: smallint('food_group').notNull(),
    state: text('state', { enum: ['raw', 'cooked'] }).notNull(),
    energyKcal: numeric('energy_kcal', { precision: 7, scale: 2, mode: 'number' }).notNull(),
    proteinG: numeric('protein_g', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    carbG: numeric('carb_g', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    fatG: numeric('fat_g', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    fiberG: numeric('fiber_g', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    ...timestamps,
  },
  (t) => [
    check('reference_food_state_check', sql`${t.state} IN ('raw', 'cooked')`),
    check('reference_food_food_group_check', sql`${t.foodGroup} BETWEEN 1 AND 18`),
  ],
);

/** A set of foods that stand in for each other (S12): okra ↔ broccoli, rice ↔ potato. */
export const rotationGroup = pgTable(
  'rotation_group',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [index('rotation_group_user_id_idx').on(t.userId)],
);

export const foodSourceValues = ['mext', 'open_food_facts', 'label_photo', 'manual'] as const;

/**
 * One food on the user's own list (S12), its values per 100 g of the state named. Archived, it is
 * off the list and out of new plans, and past plans still name it. The two keys that refuse a
 * duplicate on the list (the same barcode or MEXT code; the same name, brand and state) are
 * expression indexes, in a custom migration.
 */
export const food = pgTable(
  'food',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brand: text('brand'),
    state: text('state', { enum: ['raw', 'cooked'] })
      .notNull()
      .default('raw'),
    energyKcal: numeric('energy_kcal', { precision: 7, scale: 2, mode: 'number' }).notNull(),
    proteinG: numeric('protein_g', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    carbG: numeric('carb_g', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    fatG: numeric('fat_g', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    fiberG: numeric('fiber_g', { precision: 6, scale: 2, mode: 'number' }).notNull().default(0),
    pieceWeightG: numeric('piece_weight_g', { precision: 6, scale: 2, mode: 'number' }),
    keepsDays: smallint('keeps_days'),
    source: text('source', { enum: foodSourceValues }).notNull(),
    sourceRef: text('source_ref'),
    rotationGroupId: uuid('rotation_group_id').references(() => rotationGroup.id, {
      onDelete: 'set null',
    }),
    archivedAt: instant('archived_at'),
    ...timestamps,
  },
  (t) => [
    index('food_user_id_idx')
      .on(t.userId)
      .where(sql`${t.archivedAt} IS NULL`),
    index('food_user_id_source_ref_idx').on(t.userId, t.sourceRef),
    index('food_rotation_group_id_idx').on(t.rotationGroupId),
    check('food_state_check', sql`${t.state} IN ('raw', 'cooked')`),
    check(
      'food_source_check',
      sql`${t.source} IN ('mext', 'open_food_facts', 'label_photo', 'manual')`,
    ),
    check('food_piece_weight_g_check', sql`${t.pieceWeightG} > 0`),
    check('food_keeps_days_check', sql`${t.keepsDays} BETWEEN 1 AND 30`),
  ],
);

/**
 * Model calls a user made on one local day: label reads now, meal estimates in M3, counted together
 * against one daily cap (docs/06, 2026-09-22). A label read leaves no other row, so the count is its
 * own store. Bookkeeping, not exported.
 */
export const modelCallCount = pgTable(
  'model_call_count',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    calls: smallint('calls').notNull().default(0),
    ...timestamps,
  },
  (t) => [primaryKey({ name: 'model_call_count_pkey', columns: [t.userId, t.day] })],
);
