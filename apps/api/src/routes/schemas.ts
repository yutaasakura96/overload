import { z } from '@hono/zod-openapi';

// Response schemas shared by the routes. These generate packages/api-contract (docs/03 §2).

export const Uuid = z.uuid().openapi({ example: '0192a001-7c1e-7a33-9c2d-4b6f1e0a9d11' });

/** `{id}` in a path. A malformed one is a 400, like any parameter of the wrong type. */
export const IdParam = z.object({ id: Uuid.openapi({ param: { name: 'id', in: 'path' } }) });

/** A required JSON request body, so a body of another type is refused rather than skipped. */
export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  content: { 'application/json': { schema } },
  required: true,
});

export const Equipment = z
  .enum(['barbell', 'dumbbell', 'machine_plate', 'machine_stack', 'cable', 'bodyweight', 'other'])
  .openapi('Equipment', {
    description: 'A load-increment class, not an equipment inventory (docs/04 `exercise`).',
  });

export const Exercise = z
  .object({
    id: Uuid,
    name: z.string().openapi({ example: 'Barbell Bench Press' }),
    equipment: Equipment,
    custom: z
      .boolean()
      .openapi({ description: 'True for the caller’s own exercise, false for a seeded one.' }),
    hidden: z.boolean(),
    incrementKg: z.number().openapi({ example: 2.5 }),
    restSeconds: z.int().openapi({ example: 180 }),
    repLow: z.int().openapi({ example: 6 }),
    repHigh: z.int().openapi({ example: 10 }),
    overrides: z
      .object({
        incrementKg: z.boolean(),
        restSeconds: z.boolean(),
        repLow: z.boolean(),
        repHigh: z.boolean(),
      })
      .openapi({ description: 'Which values are the caller’s own settings rather than defaults.' }),
  })
  .openapi('Exercise');

export const ExerciseList = z.object({ items: z.array(Exercise) }).openapi('ExerciseList');

// Request bodies. Bounds follow the columns (docs/04): numeric(5,2) kilograms, smallint reps and
// set counts, an integer of seconds. A refusal names the field, never what was in it (docs/07 §1.3).

const Name = z.string().trim().min(1).max(80);
const IncrementKg = z.number().min(0).max(100).multipleOf(0.01).openapi({ example: 2.5 });
const RestSeconds = z.int().min(0).max(3600).openapi({ example: 120 });
const Reps = z.int().min(1).max(100);
const TargetSets = z.int().min(1).max(20);

/** A rep range with both ends set must not be inverted. The issue lands on `repLow`. */
const repRangeInOrder = (
  value: { repLow?: number | null | undefined; repHigh?: number | null | undefined },
  ctx: z.RefinementCtx,
) => {
  const { repLow, repHigh } = value;
  if (typeof repLow === 'number' && typeof repHigh === 'number' && repLow > repHigh) {
    ctx.addIssue({ code: 'custom', path: ['repLow'], message: 'repLow must not exceed repHigh' });
  }
};

export const ExerciseCreate = z
  .object({
    id: Uuid.openapi({ description: 'Made on the device (UUIDv7). A repeat returns the row.' }),
    name: Name.openapi({ example: 'Cable Y-Raise' }),
    equipment: Equipment,
    incrementKg: IncrementKg.optional().openapi({
      description: 'Default: the equipment class’s increment (docs/04 `exercise`).',
    }),
    restSeconds: RestSeconds.optional().openapi({ description: 'Default 120.' }),
    repLow: Reps.optional().openapi({ description: 'Default 6.' }),
    repHigh: Reps.optional().openapi({ description: 'Default 10.' }),
  })
  .superRefine(repRangeInOrder)
  .openapi('ExerciseCreate');

export const ExercisePatch = z
  .object({
    name: Name.optional(),
    equipment: Equipment.optional(),
    incrementKg: IncrementKg.optional(),
    restSeconds: RestSeconds.optional(),
    repLow: Reps.optional(),
    repHigh: Reps.optional(),
  })
  .superRefine(repRangeInOrder)
  .openapi('ExercisePatch');

export const ExerciseSettingPut = z
  .object({
    incrementKg: IncrementKg.nullable(),
    restSeconds: RestSeconds.nullable(),
    repLow: Reps.nullable(),
    repHigh: Reps.nullable(),
    hidden: z
      .boolean()
      .openapi({ description: 'Off the caller’s pickers; history still names it.' }),
  })
  .superRefine(repRangeInOrder)
  .openapi('ExerciseSetting', {
    description: 'The whole setting. `null` restores the exercise’s default for that value.',
  });

export const RoutineSlot = z
  .object({
    id: Uuid,
    exerciseId: Uuid,
    targetSets: z.int().openapi({ example: 3 }),
    repLow: z.int().nullable(),
    repHigh: z.int().nullable(),
  })
  .openapi('RoutineSlot', {
    description: 'Null reps fall back to the caller’s setting, then the exercise’s default.',
  });

export const Routine = z
  .object({
    id: Uuid,
    name: z.string().openapi({ example: 'Push A' }),
    position: z.int().openapi({ description: 'Place in the routine list, 0 first.' }),
    exercises: z.array(RoutineSlot).openapi({ description: 'In order.' }),
  })
  .openapi('Routine');

export const RoutineList = z.object({ items: z.array(Routine) }).openapi('RoutineList');

const SlotInput = z
  .object({
    id: Uuid.openapi({ description: 'Made on the device (UUIDv7).' }),
    exerciseId: Uuid,
    targetSets: TargetSets.optional().openapi({ description: 'Default 3.' }),
    repLow: Reps.nullable().optional(),
    repHigh: Reps.nullable().optional(),
  })
  .superRefine((slot, ctx) => {
    const low = slot.repLow ?? null;
    const high = slot.repHigh ?? null;
    if ((low === null) !== (high === null)) {
      ctx.addIssue({
        code: 'custom',
        path: [low === null ? 'repLow' : 'repHigh'],
        message: 'Set both ends of the rep range, or neither',
      });
    }
    repRangeInOrder(slot, ctx);
  })
  .openapi('RoutineSlotInput');

/** Order is array order. A slot id may appear once. */
const SlotList = z
  .array(SlotInput)
  .max(40)
  .superRefine((slots, ctx) => {
    const seen = new Set<string>();
    for (const [index, slot] of slots.entries()) {
      if (seen.has(slot.id)) {
        ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'Slot id used twice' });
      }
      seen.add(slot.id);
    }
  });

export const RoutineCreate = z
  .object({
    id: Uuid.openapi({ description: 'Made on the device (UUIDv7). A repeat returns the routine.' }),
    name: Name.openapi({ example: 'Push A' }),
    exercises: SlotList.optional(),
  })
  .openapi('RoutineCreate');

export const RoutinePatch = z
  .object({
    name: Name.optional(),
    position: z.int().min(0).optional().openapi({
      description: 'Move to this place in the list, 0 first; past the end means last.',
    }),
  })
  .openapi('RoutinePatch');

export const RoutineExercisesPut = z.object({ exercises: SlotList }).openapi('RoutineExercisesPut');

const WeightUnit = z.enum(['kg', 'lb']).openapi('WeightUnit', {
  description:
    'How weights are shown. Every weight is stored and sent in kg (docs/06, 2026-09-23).',
});

export const Profile = z
  .object({
    timezone: z.string().openapi({ example: 'Asia/Tokyo' }),
    heightCm: z.number().nullable(),
    sex: z.enum(['male', 'female']).nullable(),
    birthDate: z.iso.date().nullable(),
    trainingWeekdays: z
      .array(z.int().min(1).max(7))
      .openapi({ description: 'ISO weekdays, 1 = Monday.' }),
    weightUnit: WeightUnit,
  })
  .openapi('Profile');

/** An IANA time zone this runtime knows, e.g. `Asia/Tokyo`. */
const Timezone = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (zone) => {
      try {
        Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Not a known time zone' },
  )
  .openapi({ example: 'Asia/Tokyo' });

export const ProfilePatch = z
  .object({
    timezone: Timezone.optional().openapi({
      description: 'Local dates are read in it: the day boundary.',
    }),
    heightCm: z.number().positive().max(300).multipleOf(0.1).nullable().optional(),
    sex: z.enum(['male', 'female']).nullable().optional(),
    birthDate: z.iso.date().nullable().optional(),
    trainingWeekdays: z.array(z.int().min(1).max(7)).max(7).optional(),
    weightUnit: WeightUnit.optional(),
  })
  .openapi('ProfilePatch', {
    description:
      'Omitted fields are unchanged and `null` clears one. The first save creates the profile.',
  });

export const Me = z
  .object({
    user: z.object({
      id: Uuid,
      name: z.string(),
      email: z.email(),
      image: z.string().nullable(),
    }),
    isAdmin: z.boolean(),
    profile: Profile.nullable().openapi({ description: 'Null until the user has set one up.' }),
  })
  .openapi('Me');

export const Health = z.object({ status: z.literal('ok') }).openapi('Health');

// Training (docs/07 §3). Instants are ISO 8601 in UTC; weights are kilograms.

const Instant = z.iso.datetime({ offset: true }).openapi({ example: '2026-11-11T09:01:40.000Z' });
const Kilograms = z.number().min(0).max(9999.99).multipleOf(0.01);

export const Suggestion = z
  .object({
    weightKg: z.number().openapi({ example: 82.5 }),
    rule: z.enum(['top_of_range_hit', 'repeat']),
    reason: z.string().openapi({ example: 'hit 10 on every set last time' }),
  })
  .openapi('Suggestion', { description: 'Today’s weight for the exercise (S3).' });

const LastFields = {
  workoutId: Uuid,
  performedOn: z.iso.date().openapi({ description: 'The workout’s local date.' }),
  sets: z
    .array(z.object({ workingSet: z.int(), weightKg: z.number(), reps: z.int() }))
    .openapi({ description: 'Working sets only, numbered 1…n in order.' }),
  suggestion: Suggestion,
};

export const LastTimeSlot = z
  .object({
    routineId: Uuid,
    slot: z.int().min(0).openapi({
      description: 'Which of the exercise’s slots in that workout, counted from 0 in order.',
    }),
    ...LastFields,
  })
  .openapi('LastTimeSlot', {
    description: 'One slot’s own sets and suggestion, from the routine’s last workout.',
  });

export const LastTime = z
  .object({
    exerciseId: Uuid,
    ...LastFields,
    slots: z.array(LastTimeSlot).openapi({
      description:
        'Present where a routine’s last workout ran the exercise in more than one slot. Empty otherwise.',
    }),
  })
  .openapi('LastTime');

export const LastTimes = z
  .object({ asOf: Instant, exercises: z.array(LastTime) })
  .openapi('LastTimes', {
    description: 'Every exercise the caller has logged. One never logged is absent.',
  });

const WorkoutFields = {
  id: Uuid.openapi({ description: 'Made on the phone (UUIDv7).' }),
  routineId: Uuid.nullable(),
  name: z.string().trim().min(1).max(80).openapi({ example: 'Push A' }),
  startedAt: Instant,
  endedAt: Instant.nullable().openapi({ description: 'Null while the workout is in progress.' }),
  note: z.string().max(2000).nullable(),
  clientUpdatedAt: Instant.openapi({ description: 'The phone’s clock at the last edit.' }),
};

const WorkoutExerciseFields = {
  id: Uuid,
  workoutId: Uuid,
  exerciseId: Uuid,
  position: z.int().min(0).max(1000),
  targetSets: TargetSets.nullable().openapi({ description: 'Copied from the routine at start.' }),
  repLow: Reps,
  repHigh: Reps,
  incrementKg: IncrementKg,
  clientUpdatedAt: Instant,
};

const SetFields = {
  id: Uuid,
  workoutExerciseId: Uuid,
  position: z
    .int()
    .min(0)
    .max(1000)
    .openapi({ description: 'Order within the exercise, warm-ups included. Never renumbered.' }),
  weightKg: Kilograms.openapi({ example: 82.5 }),
  reps: Reps.openapi({ example: 10 }),
  rir: z.int().min(0).max(10).nullable(),
  rpe: z.number().min(1).max(10).multipleOf(0.5).nullable(),
  isWarmup: z.boolean(),
  performedAt: Instant,
  clientUpdatedAt: Instant,
};

const rangeInOrder = (row: { repLow: number; repHigh: number }, ctx: z.RefinementCtx) =>
  repRangeInOrder(row, ctx);

const oneEffort = (row: { rir: number | null; rpe: number | null }, ctx: z.RefinementCtx) => {
  if (row.rir !== null && row.rpe !== null) {
    ctx.addIssue({ code: 'custom', path: ['rpe'], message: 'Record RIR or RPE, not both' });
  }
};

export const WorkoutRow = z.object(WorkoutFields).openapi('WorkoutRow');
export const WorkoutExerciseRow = z
  .object(WorkoutExerciseFields)
  .superRefine(rangeInOrder)
  .openapi('WorkoutExerciseRow');
export const SetRow = z.object(SetFields).superRefine(oneEffort).openapi('SetRow');

const Deletion = z
  .object({ id: Uuid, deletedAt: Instant })
  .strict()
  .openapi('SyncDeletion', { description: 'A workout the phone deleted.' });

export const SyncBatch = z
  .object({
    workouts: z.array(z.union([Deletion, WorkoutRow])).default([]),
    workoutExercises: z.array(WorkoutExerciseRow).default([]),
    sets: z.array(SetRow).default([]),
  })
  .openapi('SyncBatch', {
    description:
      'The device’s queued rows, each the whole current row, parents before children. ' +
      'At most 500 rows a request.',
  });

const SyncTable = z.enum(['workouts', 'workoutExercises', 'sets']);

export const SyncResult = z
  .discriminatedUnion('status', [
    z.object({
      table: SyncTable,
      id: Uuid,
      status: z.enum(['stored', 'unchanged']),
      row: z.union([WorkoutRow, WorkoutExerciseRow, SetRow]).openapi({
        description: 'The server’s copy after this request.',
      }),
    }),
    z.object({ table: SyncTable, id: Uuid, status: z.literal('deleted') }),
    z.object({
      table: SyncTable,
      id: Uuid,
      status: z.literal('refused'),
      problem: z.object({
        code: z.enum(['not_found', 'parent_missing', 'validation_failed']),
        status: z.int(),
      }),
    }),
  ])
  .openapi('SyncResult');

export const SyncResponse = z
  .object({ results: z.array(SyncResult).openapi({ description: 'One per row sent.' }) })
  .openapi('SyncResponse');
