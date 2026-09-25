// The schema, as Drizzle tables (docs/04). drizzle-kit generates each migration's SQL from the
// difference between this file and the last snapshot in migrations/meta (`pnpm db:generate`); the
// committed SQL is what changes a database. What Drizzle cannot express (grants, functions, the
// expression index on exercise names, seed rows) lives in custom migrations beside it (docs/12 §3).
import { sql } from 'drizzle-orm';
import {
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
import { user } from './auth-schema';

export * from './auth-schema';

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
 * One row per user. Created now; the first reader of a field is slice 3. `weight_unit` is the
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
    weightUnit: text('weight_unit').notNull().default('kg'),
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

/**
 * Seeded (`owner_user_id` IS NULL) or one user's own (S8). The equipment values are a
 * load-increment taxonomy (docs/06, 2026-09-23). The unique index on `(owner_user_id, lower(name))
 * NULLS NOT DISTINCT` is in a custom migration: Drizzle's index builder has no NULLS NOT DISTINCT.
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
    ...timestamps,
  },
  (t) => [
    index('exercise_owner_user_id_idx').on(t.ownerUserId),
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
