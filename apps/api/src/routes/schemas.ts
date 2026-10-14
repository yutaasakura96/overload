import { z } from '@hono/zod-openapi';
import { BALANCE_VIEWS, MUSCLE_GROUPS, MUSCLE_STATUSES } from '../domain/balance.js';
import { SPANS } from '../domain/progress.js';
import { LIFT_STATUSES, STRENGTH_SPANS, STRENGTH_STATUSES } from '../domain/strength.js';

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

export const MuscleGroup = z
  .enum([
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
  ])
  .openapi('MuscleGroup', {
    description: 'The one group the library files an exercise under (docs/04 `exercise`).',
  });

/** A group in a list: the same values without the component's null, which no list holds. */
const MuscleGroupName = z.enum(MuscleGroup.options);

export const Exercise = z
  .object({
    id: Uuid,
    name: z.string().openapi({ example: 'Barbell Bench Press' }),
    equipment: Equipment,
    // Null on a custom exercise the caller has not filed under a group.
    muscleGroup: MuscleGroup.nullable(),
    secondaryMuscleGroups: z.array(MuscleGroupName).openapi({
      description:
        'The groups it also trains, where a working set counts half in the balance view. Each ' +
        'once, in the order of `MuscleGroup`, never `muscleGroup` itself. Empty for none.',
      example: ['shoulders', 'triceps'],
    }),
    aliases: z.array(z.string()).openapi({
      description: 'Other names for search to match, never shown as the name. Seeded only.',
      example: ['Flat Bench'],
    }),
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
const SecondaryMuscleGroups = z
  .array(MuscleGroupName)
  .max(11)
  .openapi({
    description:
      'The groups it also trains, where a set counts half. Stored each once, in order, without ' +
      'the group it is filed under.',
  });

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
    // Default: none, so the library lists it apart from the groups.
    muscleGroup: MuscleGroup.nullable().optional(),
    // Default: none. Stored each once, in order, without `muscleGroup`.
    secondaryMuscleGroups: SecondaryMuscleGroups.optional(),
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
    // `null` files it under no group.
    muscleGroup: MuscleGroup.nullable().optional(),
    // Left out, they stay. A group the exercise is now filed under drops out of them.
    secondaryMuscleGroups: SecondaryMuscleGroups.optional(),
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
    .array(
      z.object({
        workingSet: z.int(),
        weightKg: z.number(),
        reps: z.int(),
        rir: z.int().nullable().openapi({ description: 'Null when the set recorded none.' }),
      }),
    )
    .openapi({ description: 'Working sets only, numbered 1…n in order.' }),
  suggestion: Suggestion,
};

export const LastTimeSlot = z
  .object({
    routineExerciseId: Uuid.openapi({ description: 'The routine slot.' }),
    ...LastFields,
  })
  .openapi('LastTimeSlot', {
    description: 'One routine slot’s own sets and suggestion, from the last workout that ran it.',
  });

export const LastTime = z
  .object({
    exerciseId: Uuid,
    ...LastFields,
    slots: z.array(LastTimeSlot).openapi({
      description: 'Last time for each of the caller’s routine slots that has logged the exercise.',
    }),
  })
  .openapi('LastTime');

export const LastTimes = z
  .object({ asOf: Instant, exercises: z.array(LastTime) })
  .openapi('LastTimes', {
    description: 'Every exercise the caller has logged. One never logged is absent.',
  });

export const Span = z.enum(SPANS).openapi('Span', {
  description: 'How far back the chart reads: 4 or 12 weeks, 6 months, 1 year, or everything.',
});

export const ProgressPoint = z
  .object({
    workoutId: Uuid,
    workoutName: z.string().openapi({ example: 'Push A' }),
    date: z.iso.date().openapi({ description: 'The workout’s local date.' }),
    e1rmKg: z
      .number()
      .openapi({ description: 'Epley on the best working set, to the tenth.', example: 106.7 }),
    topSetKg: z.number().openapi({ description: 'The heaviest working set.', example: 80 }),
    topSetReps: z.int().openapi({ description: 'The most reps done at that weight.', example: 10 }),
    volumeKg: z.number().openapi({
      description: 'Volume load: weight × reps, summed over the working sets.',
      example: 2400,
    }),
    sets: z
      .array(z.object({ weightKg: z.number(), reps: z.int() }))
      .openapi({ description: 'The working sets as logged, in order: the exercise’s past sets.' }),
  })
  .openapi('ProgressPoint');

export const Progress = z
  .object({
    span: Span,
    from: z.iso.date().nullable().openapi({
      description:
        'The span’s first local date. For `all`, the first workout’s, and null without one.',
    }),
    to: z.iso.date().openapi({ description: 'Today, in the caller’s time zone.' }),
    points: z
      .array(ProgressPoint)
      .openapi({ description: 'One per workout with a working set of it, oldest first.' }),
    stats: z
      .object({
        bestE1rmKg: z.number().nullable().openapi({ example: 106.7 }),
        changeKg: z
          .number()
          .nullable()
          .openapi({
            description:
              'The last workout’s e1RM less the first’s, from the estimates before they are rounded, ' +
              'to the thousandth. Null with fewer than two.',
            example: 5.367,
          }),
        topSetKg: z.number().nullable().openapi({ example: 82.5 }),
        topSetReps: z.int().nullable().openapi({ example: 10 }),
        volumeKg: z.number().openapi({ example: 28800 }),
      })
      .openapi({
        description:
          'Over the span: the best e1RM, the heaviest top set with the most reps done at it, ' +
          'and the volume load of every workout together. Null without a workout.',
      }),
  })
  .openapi('Progress', {
    description: 'One exercise’s chart (S7). Warm-ups are left out of every number (S6).',
  });

export const StrengthStatus = z.enum(STRENGTH_STATUSES).openapi('StrengthStatus', {
  description:
    'Gaining is a trend up 2% or more across the span, losing one down 2% or more, holding ' +
    'anything between.',
});

export const StrengthLift = z
  .object({
    exerciseId: Uuid,
    name: z.string().openapi({ example: 'Barbell Bench Press' }),
    points: z
      .array(
        z.object({
          date: z.iso.date().openapi({ description: 'The workout’s local date.' }),
          e1rmKg: z.number().openapi({
            description: 'Epley on the best working set, to the tenth.',
            example: 106.7,
          }),
        }),
      )
      .openapi({ description: 'One per workout with a positive e1RM in the span, oldest first.' }),
    workoutCount: z.int().openapi({ description: 'Workouts with a working set in the span.' }),
    status: z.enum(LIFT_STATUSES).openapi({
      description:
        'The lift’s verdict, `too_few` below three workouts, `no_trend` when a percentage cannot be calculated, or `no_weight` without a positive e1RM.',
    }),
    trend: z
      .object({
        changeKg: z.number().openapi({
          description: 'The trend line’s end less its start, to the thousandth.',
          example: 4.712,
        }),
        changePct: z.number().openapi({
          description: 'That change as a share of the line’s start, to the tenth.',
          example: 4.6,
        }),
      })
      .nullable()
      .openapi({ description: 'Null without a verdict.' }),
  })
  .openapi('StrengthLift');

export const StrengthOverview = z
  .object({
    span: z.enum(STRENGTH_SPANS),
    from: z.iso.date().openapi({
      description: 'The span’s first local date.',
    }),
    to: z.iso.date().openapi({ description: 'Today, in the caller’s time zone.' }),
    overall: z
      .object({
        lifts: z.int().openapi({ description: 'How many lifts have a verdict.', example: 13 }),
        changePct: z.number().nullable().openapi({ example: 2.7 }),
        status: StrengthStatus.nullable(),
      })
      .openapi({
        description:
          'The plain average of every verdict’s unrounded percentage, judged before rounding ' +
          'to the tenth for display. Null without a lift to average.',
      }),
    lifts: z.array(StrengthLift).openapi({
      description: 'The lifts with a verdict, the largest gain first; then those without, by name.',
    }),
  })
  .openapi('StrengthOverview', {
    description:
      'Every lift the caller logged with a working set in the span, with the trend of its e1RM. Warm-ups are left out (S6).',
  });

export const MuscleBalance = z
  .object({
    // Not the `MuscleGroup` component, which carries the null of an unfiled exercise.
    muscleGroup: z.enum(MUSCLE_GROUPS),
    sets: z.number().openapi({
      description:
        'Working sets a week, whole and half, to the tenth. The status reads this figure.',
      example: 14,
    }),
    directSets: z.number().openapi({
      description: 'The whole sets among them, to the tenth: those of exercises filed under it.',
      example: 5.3,
    }),
    status: z.enum(MUSCLE_STATUSES).openapi({
      description:
        '`none` at 0, `low` under the range, `in_range` from its low to its high end, `high` over it.',
    }),
    sources: z
      .array(
        z.object({
          exerciseId: Uuid,
          name: z.string().openapi({ example: 'Barbell Bench Press' }),
          indirect: z.boolean().openapi({
            description: 'True where the exercise trains the group indirectly, at half a set.',
          }),
          sets: z.number().openapi({
            description: 'What it adds a week, to the tenth: already halved where indirect.',
            example: 3.5,
          }),
        }),
      )
      .openapi({ description: 'The exercises its sets came from, by when each first came up.' }),
  })
  .openapi('MuscleBalance');

export const Balance = z
  .object({
    view: z.enum(BALANCE_VIEWS),
    from: z.iso.date().openapi({ description: 'The view’s first local date.' }),
    to: z.iso.date().openapi({ description: 'Today, in the caller’s time zone.' }),
    weeks: z.int().openapi({ description: 'What the sets are divided by: 4, or 1 for this week.' }),
    range: z
      .object({ low: z.int().openapi({ example: 10 }), high: z.int().openapi({ example: 20 }) })
      .openapi({ description: 'The weekly range every group is read against.' }),
    groups: z.array(MuscleBalance).openapi({
      description: 'All eleven groups, in the order of `MuscleGroup`, trained or not.',
    }),
  })
  .openapi('Balance', {
    description:
      'Working sets a week for each muscle group: whole for the group an exercise is filed under, half for each it also trains. Warm-ups are left out (S6).',
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
  routineExerciseId: Uuid.nullable()
    .default(null)
    .openapi({
      description:
        'The routine slot it was started from. Null, or left out by a row made before the field ' +
        'existed, when it came from none.',
    }),
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

// History (docs/07 §3, Reading workouts).

export const WorkoutSummary = z
  .object({
    id: Uuid,
    name: z.string().openapi({ example: 'Push A' }),
    startedAt: Instant,
    endedAt: Instant,
    workingSets: z.int().openapi({ description: 'Warm-ups are not counted (S6).', example: 13 }),
    exercises: z
      .array(
        z.object({
          name: z.string().openapi({ example: 'Barbell Bench Press' }),
          topSetKg: z.number().openapi({ description: 'The heaviest working set.', example: 80 }),
          topSetReps: z
            .int()
            .openapi({ description: 'The most reps done at that weight.', example: 10 }),
        }),
      )
      .openapi({
        description: 'Each exercise that logged a working set, in the workout’s order.',
      }),
  })
  .openapi('WorkoutSummary');

export const WorkoutList = z
  .object({
    items: z.array(WorkoutSummary),
    nextCursor: z
      .string()
      .nullable()
      .openapi({ description: 'Opaque. Send it back as `cursor` for the next page.' }),
    total: z.int().openapi({ description: 'How many finished workouts the caller has in all.' }),
  })
  .openapi('WorkoutList', {
    description: 'Finished workouts, newest `startedAt` first. One in progress is not listed.',
  });

export const WorkoutDetail = z
  .object({
    ...WorkoutFields,
    exercises: z
      .array(
        z.object({
          ...WorkoutExerciseFields,
          routineExerciseId: Uuid.nullable(),
          name: z.string().openapi({ example: 'Barbell Bench Press' }),
          sets: z
            .array(z.object(SetFields))
            .openapi({ description: 'In `position` order, warm-ups included.' }),
        }),
      )
      .openapi({ description: 'In order. One that logged no set is still listed.' }),
  })
  .openapi('WorkoutDetail', {
    description:
      'One workout whole. Every row is as the sync batch holds it, so a set can be sent back ' +
      'edited, or deleted, through `/api/workouts/sync`.',
  });

export const SyncDeletion = z
  .object({ id: Uuid, deletedAt: Instant })
  .strict()
  .openapi('SyncDeletion', {
    description:
      'A row the phone deleted. It goes if the stored copy is older than `deletedAt`, and its id ' +
      'is kept so a stale copy cannot bring it back.',
  });

// The last member of each array's union. Without it one row an older build wrote would fail the
// whole batch as a 422, and every set behind it would wait for good (docs/07 §3.4).
const SyncUnreadableRow = z.looseObject({ id: Uuid }).openapi('SyncUnreadableRow', {
  description:
    'Any other row with an id. It is not applied: its result is `refused` with ' +
    '`validation_failed`, and the rest of the batch is applied as usual.',
});

const rowsOf = <Row extends z.ZodType>(row: Row) =>
  z.array(z.union([SyncDeletion, row, SyncUnreadableRow])).default([]);

export const SyncBatch = z
  .object({
    workouts: rowsOf(WorkoutRow),
    workoutExercises: rowsOf(WorkoutExerciseRow),
    sets: rowsOf(SetRow),
  })
  .openapi('SyncBatch', {
    description:
      'The device’s queued rows, each the whole current row or its deletion, parents before ' +
      'children. At most 500 rows a request.',
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
        errors: z
          .array(z.object({ path: z.string(), message: z.string() }))
          .optional()
          .openapi({
            description:
              'Present when the row did not match its schema: the fields at fault, never a value.',
          }),
      }),
    }),
  ])
  .openapi('SyncResult');

export const SyncResponse = z
  .object({ results: z.array(SyncResult).openapi({ description: 'One per row sent.' }) })
  .openapi('SyncResponse');
