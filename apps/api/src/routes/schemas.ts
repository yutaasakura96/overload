import { z } from '@hono/zod-openapi';
import { BALANCE_VIEWS, MUSCLE_GROUPS, MUSCLE_STATUSES } from '../domain/balance.js';
import { BASIS_KINDS, PER_100G_MAX } from '../domain/food.js';
import { SPANS } from '../domain/progress.js';
import { LIFT_STATUSES, STRENGTH_SPANS, STRENGTH_STATUSES } from '../domain/strength.js';
import { CALORIE_TARGET_KCAL } from '../domain/targets.js';

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
export const Timezone = z
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

export const BodyweightCount = z
  .discriminatedUnion('basis', [
    z.object({
      basis: z.enum(['same_day', 'earlier_day', 'later_day']).openapi({
        description:
          '`same_day`: the day’s own weight. `earlier_day`: no reading that day, so the latest ' +
          'earlier day’s. `later_day`: the workout is older than the first weigh-in, so the first ' +
          'later one.',
      }),
      weightKg: z.number().openapi({ example: 82.4 }),
      weighedOn: z.iso.date().openapi({ description: 'The local date of the weigh-in counted.' }),
    }),
    z.object({
      basis: z.literal('none').openapi({ description: 'No weigh-in at all: sets as logged.' }),
    }),
  ])
  .openapi({
    description:
      'Which weigh-in a bodyweight lift was counted at (issue #69): all of that weight plus ' +
      'the kg logged on the set.',
  });

const LastFields = {
  workoutId: Uuid,
  performedOn: z.iso.date().openapi({ description: 'The workout’s local date.' }),
  sets: z
    .array(
      z.object({
        workingSet: z.int(),
        weightKg: z.number(),
        countedWeightKg: z.number().openapi({
          description: 'The load counted for display; weightKg remains the logged added load.',
        }),
        reps: z.int(),
        rir: z.int().nullable().openapi({ description: 'Null when the set recorded none.' }),
      }),
    )
    .openapi({ description: 'Working sets only, numbered 1…n in order.' }),
  suggestion: Suggestion,
  bodyweight: BodyweightCount.nullable(),
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
    sets: z.array(z.object({ weightKg: z.number(), reps: z.int() })).openapi({
      description:
        'The working sets in order: the exercise’s past sets. A bodyweight lift’s are as counted.',
    }),
    // Null on a lift of any other equipment.
    bodyweight: BodyweightCount.nullable(),
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
    // Null on a lift of any other equipment; else the weigh-in its latest workout was counted at.
    bodyweight: BodyweightCount.nullable(),
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
    routineId: Uuid.nullable().openapi({
      description:
        'The routine it was started from; null when it came from none, or the routine is gone.',
    }),
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

export const LastDone = z
  .object({
    items: z.array(
      z.object({
        routineId: Uuid,
        workoutId: Uuid.openapi({ description: 'The routine’s newest finished workout.' }),
        startedAt: Instant,
      }),
    ),
  })
  .openapi('LastDone', {
    description:
      'When each of the caller’s routines was last done. A routine never done, or deleted, is absent.',
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

// Invite administration (docs/07 §2). What the admin sees of an invite, and nothing about what its
// member has logged (docs/08 §4).

export const Invite = z
  .object({
    id: Uuid,
    email: z.email().openapi({ example: 'kenji.tanaka@example.com' }),
    note: z.string().nullable().openapi({ example: 'gym friend' }),
    invitedAt: Instant,
    revokedAt: Instant.nullable().openapi({ description: 'Null while the invite admits them.' }),
  })
  .openapi('Invite');

export const InviteList = z.object({ items: z.array(Invite) }).openapi('InviteList');

export const InviteCreate = z
  .object({
    id: Uuid.openapi({ description: 'Made on the device (UUIDv7). A repeat returns the invite.' }),
    email: z.email().max(254).openapi({
      description: 'A Google email. Stored lowercased.',
      example: 'Kenji.Tanaka@example.com',
    }),
    note: z.string().trim().max(200).nullable().optional().openapi({ example: 'gym friend' }),
  })
  .openapi('InviteCreate');

// Weight (S11, docs/07 §5). Every weight is kilograms; the profile's unit is for the screen only.

/** A bodyweight a person can weigh, to the hundredth (numeric(5,2), docs/04 `body_measurement`). */
const BodyweightKg = z.number().min(20).max(300).multipleOf(0.01).openapi({ example: 82.4 });
const BodyFatPct = z.number().min(1).max(75).multipleOf(0.1).openapi({ example: 18.5 });

export const WeighIn = z
  .object({
    id: Uuid,
    measuredAt: Instant.openapi({
      description: 'When the reading was taken, not when it arrived.',
    }),
    weightKg: BodyweightKg,
    bodyFatPct: BodyFatPct.nullable(),
    source: z.enum(['apple_health', 'manual']).openapi({
      description: '`manual` was typed by hand and can be deleted; `apple_health` cannot be.',
    }),
  })
  .openapi('WeighIn');

export const WeighInCreate = z
  .object({
    id: Uuid.openapi({ description: 'Made on the device (UUIDv7). A repeat returns the row.' }),
    measuredAt: Instant,
    weightKg: BodyweightKg,
    bodyFatPct: BodyFatPct.nullable().optional().openapi({ description: 'Default: none.' }),
  })
  .openapi('WeighInCreate');

export const WeightDay = z
  .object({
    date: z.iso.date().openapi({ description: 'A local date in the profile’s time zone.' }),
    weighInId: Uuid.openapi({ description: 'The reading that stands for the day.' }),
    weightKg: BodyweightKg,
    morning: z.boolean().openapi({
      description:
        'False when the day had no reading before 10:00 local and its first reading stands in.',
    }),
    trendKg: z.number().nullable().openapi({
      description:
        'The trend on this day, to the hundredth. Null while fewer than 3 days are weighed.',
    }),
  })
  .openapi('WeightDay');

export const WeighIns = z
  .object({
    weighIns: z
      .array(WeighIn)
      .openapi({ description: 'Every reading in the range, newest first.' }),
    days: z
      .array(WeightDay)
      .openapi({ description: 'The weighed days in the range, newest first.' }),
    trendAvailable: z
      .boolean()
      .openapi({ description: 'False with fewer than 3 weighed days up to `to`.' }),
    weekChangeKg: z
      .number()
      .nullable()
      .openapi({
        description:
          'The latest trend less the trend a week before today, to the hundredth. Null without a ' +
          'trend, or with no weighed day a week or more before today.',
      }),
  })
  .openapi('WeighIns');

// The food list and its sources (S12, docs/07 §4). Every stored value is per 100 g of the state
// named; a lookup's candidate carries its source's basis, and the API converts.

export const FoodState = z.enum(['raw', 'cooked']).openapi('FoodState', {
  description: 'The state the values are for: weighed raw, or weighed cooked.',
});

export const FoodSource = z
  .enum(['mext', 'open_food_facts', 'label_photo', 'manual'])
  .openapi('FoodSource');

export const Basis = z
  .object({
    kind: z.enum(BASIS_KINDS),
    grams: z.number().positive().max(10000).nullable().openapi({
      description:
        'The weight of the stated amount, when known. `per_100g` is 100 whatever is sent; `per_100ml` needs the weight of 100 ml.',
    }),
  })
  .openapi('Basis', { description: 'The amount a set of values is for (docs/07 §4).' });

/** A value per 100 g, to the hundredth, as `numeric(6,2)` keeps it. */
const per100 = (max: number) => z.number().min(0).max(max).multipleOf(0.01);
const PieceWeightG = z.number().positive().max(5000).multipleOf(0.01).openapi({ example: 55 });
const KeepsDays = z.int().min(1).max(30).openapi({ example: 4 });
const Brand = z.string().trim().min(1).max(80);
const SourceRef = z.string().trim().min(1).max(40);

const Per100gFields = {
  energyKcal: per100(PER_100G_MAX.energyKcal).openapi({ example: 105 }),
  proteinG: per100(PER_100G_MAX.proteinG).openapi({ example: 23.3 }),
  carbG: per100(PER_100G_MAX.carbG).openapi({ example: 0.1 }),
  fatG: per100(PER_100G_MAX.fatG).openapi({ example: 1.9 }),
  fiberG: per100(PER_100G_MAX.fiberG).openapi({ example: 0 }),
};

export const Food = z
  .object({
    id: Uuid,
    name: z.string().openapi({ example: '鶏むね肉（皮なし）' }),
    brand: z.string().nullable(),
    state: FoodState,
    ...Per100gFields,
    pieceWeightG: PieceWeightG.nullable().openapi({
      description: 'Set for a food counted in pieces. Null: counted in grams.',
    }),
    keepsDays: KeepsDays.nullable().openapi({
      description: 'How many days a cooked batch keeps. Null: not batch-cooked.',
    }),
    source: FoodSource,
    sourceRef: z
      .string()
      .nullable()
      .openapi({ description: 'The MEXT food code, or the barcode.' }),
    rotationGroupId: Uuid.nullable(),
    archivedAt: Instant.nullable().openapi({
      description: 'Off the list and out of new plans; past plans still name it.',
    }),
  })
  .openapi('Food', { description: 'One food on the list. Values are per 100 g of `state`.' });

export const FoodList = z.object({ items: z.array(Food) }).openapi('FoodList');

/** A value as a source or the user gave it, on its basis. Bounded per 100 g after conversion. */
const Given = z.number().min(0).max(100000);

export const FoodCreate = z
  .object({
    id: Uuid.openapi({ description: 'Made on the device (UUIDv7). A repeat returns the row.' }),
    name: Name.openapi({ example: 'サラダチキン プレーン' }),
    brand: Brand.nullable().optional().openapi({ description: 'Default: none.' }),
    state: FoodState,
    basis: Basis,
    energyKcal: Given,
    proteinG: Given,
    carbG: Given,
    fatG: Given,
    fiberG: Given.nullable().openapi({
      description: 'Null when the source gave none: saved as 0.',
    }),
    pieceWeightG: PieceWeightG.nullable().optional(),
    keepsDays: KeepsDays.nullable().optional(),
    source: FoodSource,
    sourceRef: SourceRef.nullable().optional(),
    rotationGroupId: Uuid.nullable().optional(),
  })
  .openapi('FoodCreate', {
    description:
      'A confirmed food, with its values on the basis they were read in. The API converts to per 100 g.',
  });

export const FoodPatch = z
  .object({
    name: Name.optional(),
    brand: Brand.nullable().optional(),
    state: FoodState.optional(),
    energyKcal: Per100gFields.energyKcal.optional(),
    proteinG: Per100gFields.proteinG.optional(),
    carbG: Per100gFields.carbG.optional(),
    fatG: Per100gFields.fatG.optional(),
    fiberG: Per100gFields.fiberG.optional(),
    pieceWeightG: PieceWeightG.nullable().optional(),
    keepsDays: KeepsDays.nullable().optional(),
    rotationGroupId: Uuid.nullable().optional(),
  })
  .openapi('FoodPatch', { description: 'Values per 100 g. An omitted field is unchanged.' });

export const ReferenceFood = z
  .object({
    code: z.string().openapi({ example: '11220' }),
    name: z.string().openapi({
      description: 'As MEXT prints it.',
      example: '＜鳥肉類＞　にわとり　［若どり・主品目］　むね　皮なし　生',
    }),
    nameEn: z.string().nullable().openapi({
      description: 'From the 2015 English table, by food number. Null for a food added since.',
      example: 'Chicken, broiler, breast, meat without skin, raw',
    }),
    foodGroup: z.int().openapi({ description: 'MEXT 食品群, 1 to 18.' }),
    state: FoodState,
    ...Per100gFields,
    existingFoodId: Uuid.nullable().openapi({
      description: 'The food on the caller’s list with this MEXT code, if there is one.',
    }),
  })
  .openapi('ReferenceFood', {
    description: 'One entry of 日本食品標準成分表（八訂）増補2023年 (MEXT), per 100 g.',
  });

export const ReferenceFoodList = z
  .object({ items: z.array(ReferenceFood) })
  .openapi('ReferenceFoodList');

const GivenValue = z.number().nullable();

export const FoodCandidate = z
  .object({
    name: z.string().nullable(),
    brand: z.string().nullable(),
    state: FoodState.nullable().openapi({ description: 'Null when the source does not say.' }),
    basis: Basis,
    energyKcal: GivenValue,
    proteinG: GivenValue,
    carbG: GivenValue,
    fatG: GivenValue,
    fiberG: GivenValue,
  })
  .openapi('FoodCandidate', {
    description:
      'What a source gave, as printed, on its basis. A value it did not give is null, never a guess. Not saved.',
  });

const Per100gCandidate = z
  .object({
    energyKcal: GivenValue,
    proteinG: GivenValue,
    carbG: GivenValue,
    fatG: GivenValue,
    fiberG: GivenValue,
  })
  .nullable()
  .openapi({
    description:
      'The candidate converted to per 100 g, as it would be saved. Null when the basis has no weight.',
  });

export const BarcodeLookup = z
  .object({
    // A union, not `.nullable()`: that would make the registered FoodCandidate itself nullable.
    candidate: z.union([FoodCandidate, z.null()]).openapi({
      description: 'Null when the barcode is on the list already: nothing is looked up.',
    }),
    per100g: Per100gCandidate,
    existingFoodId: Uuid.nullable().openapi({
      description: 'The food on the caller’s list with this barcode, if there is one.',
    }),
  })
  .openapi('BarcodeLookup');

export const LabelReadResult = z
  .object({
    candidate: FoodCandidate,
    per100g: Per100gCandidate,
    model: z.string().openapi({ example: 'claude-haiku-4-5' }),
  })
  .openapi('LabelRead');

export const RotationGroup = z
  .object({
    id: Uuid,
    name: z.string().openapi({ example: 'Starch' }),
    foodIds: z.array(Uuid).openapi({ description: 'Its foods on the list, by name.' }),
  })
  .openapi('RotationGroup');

export const RotationGroupList = z
  .object({ items: z.array(RotationGroup) })
  .openapi('RotationGroupList');

/** A food may appear once. */
const FoodIds = z
  .array(Uuid)
  .max(100)
  .superRefine((ids, ctx) => {
    for (const [index, id] of ids.entries()) {
      if (ids.indexOf(id) !== index) {
        ctx.addIssue({ code: 'custom', path: [index], message: 'Food listed twice' });
      }
    }
  });

export const RotationGroupCreate = z
  .object({
    id: Uuid.openapi({ description: 'Made on the device (UUIDv7). A repeat returns the group.' }),
    name: Name.openapi({ example: 'Starch' }),
    foodIds: FoodIds.openapi({
      description: 'Its foods. Each leaves any group it was in.',
    }),
  })
  .openapi('RotationGroupCreate');

export const RotationGroupPatch = z
  .object({
    name: Name.optional(),
    foodIds: FoodIds.optional().openapi({
      description: 'The whole membership. A food left out stays on the list, ungrouped.',
    }),
  })
  .openapi('RotationGroupPatch');

// Goal phase, routine and targets (S14, S15, docs/07 §4). Local dates are `YYYY-MM-DD`, local
// times `HH:MM`, both in the profile's time zone.

const LocalDate = z.iso.date().openapi({ example: '2026-10-16' });
export const LocalTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time as HH:MM')
  .openapi({ example: '18:30' });

export const GoalPhaseType = z.enum(['cut', 'bulk', 'maintain']).openapi('GoalPhaseType');
export const CalorieBasis = z
  .enum(['provisional_formula', 'measured', 'manual'])
  .openapi('CalorieBasis', {
    description:
      '`provisional_formula` puts the provisional label on screen until the maintenance check is applied (S14).',
  });

const RatePct = z.number().min(0.05).max(2).multipleOf(0.01).openapi({ example: 0.5 });
const ProteinGPerKg = z.number().min(1).max(4).multipleOf(0.01).openapi({ example: 2.2 });
const FatPct = z.number().min(10).max(60).multipleOf(0.1).openapi({ example: 25 });
const CalorieTarget = z
  .int()
  .min(CALORIE_TARGET_KCAL.min)
  .max(CALORIE_TARGET_KCAL.max)
  .openapi({ example: 2350 });

export const GoalPhase = z
  .object({
    id: Uuid,
    type: GoalPhaseType,
    startedOn: LocalDate,
    endedOn: LocalDate.nullable().openapi({ description: 'Null on the open phase.' }),
    targetRatePctPerWeek: RatePct.nullable().openapi({
      description:
        '% of bodyweight a week, lost on a cut or gained on a bulk. Null on maintenance.',
    }),
    proteinGPerKg: ProteinGPerKg,
    fatPctCalories: FatPct,
    calorieTargetKcal: CalorieTarget,
    calorieBasis: CalorieBasis,
    calorieTargetSetAt: Instant.openapi({ description: 'When the calories were last set.' }),
    calorieTargetStale: z.boolean().openapi({
      description:
        'The training weekdays changed while there was no bodyweight to work the formula from, so the provisional calories are for the old ones. Cleared when the calories are next set or worked out.',
    }),
  })
  .openapi('GoalPhase');

export const GoalPhaseList = z.object({ items: z.array(GoalPhase) }).openapi('GoalPhaseList');

const ratePerType = (
  phase: { type: 'cut' | 'bulk' | 'maintain'; targetRatePctPerWeek?: number | null | undefined },
  ctx: z.RefinementCtx,
) => {
  const hasRate = phase.targetRatePctPerWeek != null;
  if (hasRate === (phase.type === 'maintain')) {
    ctx.addIssue({
      code: 'custom',
      path: ['targetRatePctPerWeek'],
      message: phase.type === 'maintain' ? 'Maintenance has no rate' : 'A cut or bulk needs a rate',
    });
  }
};

export const GoalPhaseCreate = z
  .object({
    id: Uuid.openapi({ description: 'Made on the device (UUIDv7). A repeat returns the phase.' }),
    type: GoalPhaseType,
    startedOn: LocalDate,
    targetRatePctPerWeek: RatePct.nullable(),
    proteinGPerKg: ProteinGPerKg,
    fatPctCalories: FatPct,
    calorieTargetKcal: CalorieTarget,
    calorieBasis: z.enum(['provisional_formula', 'manual']).openapi({
      description:
        '`provisional_formula` when the calories were not set by hand: the API stores the formula’s figure for the current inputs in their place.',
    }),
    endPrevious: z.boolean().optional().openapi({
      description: 'Ends the open phase on the day before. Without it an open phase is a 409.',
    }),
  })
  .superRefine(ratePerType)
  .openapi('GoalPhaseCreate');

export const GoalPhasePatch = z
  .object({
    targetRatePctPerWeek: RatePct.nullable().optional(),
    proteinGPerKg: ProteinGPerKg.optional(),
    fatPctCalories: FatPct.optional(),
    calorieTargetKcal: CalorieTarget.optional(),
    calorieBasis: CalorieBasis.optional().openapi({
      description:
        '`measured` applies the maintenance check by hand (docs/09 F13). While the phase is on `provisional_formula`, a patch to its rate or calories stores the formula’s figure for the current inputs in place of `calorieTargetKcal`.',
    }),
  })
  .openapi('GoalPhasePatch', { description: 'An omitted field is unchanged.' });

export const SourceKey = z
  .enum([
    'rate_cut',
    'rate_bulk',
    'protein_g_per_kg',
    'fat_pct_calories',
    'provisional_calories',
    'protein_per_meal',
    'carb_timing_training',
  ])
  .openapi('SourceKey', {
    description: 'The evidence a default or a recommendation rests on, its claim and sources.',
  });

const Default = (value: z.ZodNumber) =>
  z.object({
    value,
    range: z
      .array(z.number())
      .length(2)
      .openapi({ description: 'The range it sits in, low then high.' }),
    sourceKey: SourceKey,
  });

export const PhaseDefaults = z
  .object({
    type: GoalPhaseType,
    bodyweight: z.object({ weightKg: z.number(), date: LocalDate }).openapi({
      description: 'The trend weight, or the latest weigh-in before there is a trend.',
    }),
    targetRatePctPerWeek: Default(z.number())
      .nullable()
      .openapi({ description: 'Null on maintenance.' }),
    proteinGPerKg: Default(z.number()),
    fatPctCalories: Default(z.number()),
    calories: z
      .object({
        value: z.int().openapi({ description: 'kcal a day, to the nearest 10.' }),
        basis: z.literal('provisional_formula'),
        formula: z.literal('mifflin_st_jeor'),
        restingKcal: z.int(),
        activityLevel: z.number(),
        trainingDaysPerWeek: z.int(),
        adjustmentKcal: z
          .int()
          .openapi({ description: 'The deficit (negative) or surplus a day.' }),
        age: z.int(),
        sourceKey: SourceKey,
      })
      .openapi({ description: 'Provisional until the maintenance check is applied (S14).' }),
  })
  .openapi('PhaseDefaults');

export const DayType = z.enum(['training', 'rest']).openapi('DayType');

export const MealSlot = z
  .object({ position: z.int(), time: LocalTime, label: z.string().nullable() })
  .openapi('MealSlot');

export const DayRoutine = z
  .object({
    dayType: DayType,
    wakeTime: LocalTime,
    workStart: LocalTime.nullable(),
    workEnd: LocalTime.nullable(),
    trainingTime: LocalTime.nullable().openapi({ description: 'Null on a rest day.' }),
    bedTime: LocalTime,
    mealCount: z.int(),
    slots: z.array(MealSlot).openapi({ description: 'The meals, in order.' }),
  })
  .openapi('DayRoutine');

export const DayRoutineList = z
  .object({
    items: z
      .array(DayRoutine)
      .openapi({ description: 'Training first. A day type not set is absent.' }),
  })
  .openapi('DayRoutineList');

export const DayRoutinePut = z
  .object({
    wakeTime: LocalTime,
    workStart: LocalTime.nullable(),
    workEnd: LocalTime.nullable(),
    trainingTime: LocalTime.nullable().openapi({ description: 'Required on a training day.' }),
    bedTime: LocalTime,
    slots: z
      .array(z.object({ time: LocalTime, label: z.string().trim().min(1).max(40).nullable() }))
      .min(1)
      .max(8)
      .openapi({ description: 'The meals, in order: their count is the meal count.' }),
  })
  .openapi('DayRoutinePut');

export const MealRecommendation = z
  .object({
    dayType: DayType,
    recommendedCount: z.int(),
    mealCount: z.int().openapi({ description: 'The count asked about, or the recommendation.' }),
    roomFor: z.int().openapi({ description: 'The most meals the waking day has room for.' }),
    slots: z.array(
      z.object({
        position: z.int(),
        time: LocalTime,
        label: z.string(),
        isPreTraining: z.boolean(),
        isPostTraining: z.boolean(),
      }),
    ),
    proteinG: z.number().openapi({ description: 'The day’s protein target.' }),
    weightKg: z.number(),
    proteinPerMealG: z.number(),
    proteinPerMealGPerKg: z.number(),
    perMealRange: z
      .array(z.number())
      .length(2)
      .openapi({ description: 'g per kg a meal, low then high.' }),
    perMeal: z.enum(['inside', 'above', 'below']),
    sourceKey: SourceKey,
  })
  .openapi('MealRecommendation', {
    description: 'S15: the count and times, and the protein each meal carries.',
  });

const Macros = z.object({
  energyKcal: z.number(),
  proteinG: z.number(),
  carbG: z.number(),
  fatG: z.number(),
});

export const CurrentTargets = z
  .object({
    date: LocalDate,
    goalPhaseId: Uuid,
    ...Macros.shape,
    bodyweightKg: z.number(),
    source: z.object({
      kind: z.enum(['provisional_formula', 'goal_phase']).openapi({
        description: '`provisional_formula` is what puts the provisional label on screen.',
      }),
    }),
  })
  .openapi('CurrentTargets');

// Plan days (S16, docs/07 §4).

const PlanPer100g = z.object({ ...Macros.shape, fiberG: z.number() });

export const PlanShortfall = z
  .discriminatedUnion('target', [
    z.object({
      target: z.literal('protein'),
      missingG: z.int(),
      suggestion: z.literal('add_protein_source'),
    }),
    z.object({
      target: z.literal('energy'),
      missingKcal: z.int(),
      cause: z.enum(['portion_cap', 'foods']).openapi({
        description:
          '`portion_cap`: a portion reached its cap; `foods`: the list has no more to give.',
      }),
      suggestion: z.literal('add_food').nullable(),
    }),
  ])
  .openapi('PlanShortfall', { description: 'A target the plan could not reach, never padded.' });

export const PlanItem = z
  .object({
    id: Uuid,
    foodId: Uuid.nullable(),
    name: z.string(),
    plannedGrams: z.number().nullable(),
    actualGrams: z.number().nullable(),
    pieceCount: z.number().nullable().openapi({ description: 'Whole pieces of a unit food.' }),
    cooked: z.boolean().openapi({ description: 'The grams are a cooked weight.' }),
    approximate: z.boolean().openapi({
      description: 'A cooked weight with no batch yield recorded: the values are approximate.',
    }),
    noCookedMatch: z.boolean().openapi({
      description:
        'A batch-cooked food with no cooked values in the food table: planned raw, by its raw values.',
    }),
    per100g: PlanPer100g.openapi({ description: 'The food’s values as the plan used them.' }),
  })
  .openapi('PlanItem');

export const PlanMeal = z
  .object({
    id: Uuid,
    position: z.int(),
    plannedTime: LocalTime,
    label: z.string().nullable(),
    isPreTraining: z.boolean(),
    isPostTraining: z.boolean(),
    status: z.enum(['planned', 'as_planned', 'adjusted', 'replaced', 'skipped']),
    confirmedAt: Instant.nullable(),
    evidence: z.array(
      z.object({
        claim: z.string(),
        strength: z.enum(['strong', 'moderate', 'contested']),
        sourceKey: SourceKey,
      }),
    ),
    items: z.array(PlanItem),
  })
  .openapi('PlanMeal');

export const PlanDay = z
  .object({
    id: Uuid,
    date: LocalDate,
    dayType: DayType,
    goalPhaseId: Uuid.nullable(),
    complete: z.boolean().openapi({ description: 'No meal left at `planned`.' }),
    targets: Macros.openapi({ description: 'Copied from the targets in force when generated.' }),
    planned: PlanPer100g,
    confirmed: PlanPer100g,
    shortfalls: z.array(PlanShortfall),
    generatedAt: Instant,
    meals: z.array(PlanMeal),
  })
  .openapi('PlanDay');

export const PlanDays = z
  .object({
    missing: z.array(LocalDate).openapi({ description: 'Dates in the range with no plan.' }),
    days: z.array(PlanDay).openapi({ description: 'Oldest first.' }),
  })
  .openapi('PlanDays');

export const PlanRange = z
  .object({ from: LocalDate, to: LocalDate })
  .openapi('PlanRange', { description: 'Local dates, both included, at most 31 days.' });

// The export (S10, docs/07 §2): one section a call, each item as the API's normal read returns it.

export const EXPORT_SECTIONS = [
  'profile',
  'exercises',
  'routines',
  'workouts',
  'weighIns',
  'foods',
  'rotationGroups',
] as const;

export const ExportSection = z.enum(EXPORT_SECTIONS).openapi('ExportSection', {
  description: 'The sections built so far. Later milestones add theirs (docs/07 §2).',
});

export const PLANNING_EXPORT_SECTIONS = ['phases', 'dayRoutines', 'planDays'] as const;
export const PlanningExportSection = z
  .enum(PLANNING_EXPORT_SECTIONS)
  .openapi('PlanningExportSection');

const exportPage = <Section extends string, Item extends z.ZodType>(section: Section, item: Item) =>
  z.object({
    section: z.literal(section),
    items: z.array(item),
    nextCursor: z
      .string()
      .nullable()
      .openapi({ description: 'Opaque. Send it back as `cursor` for the next page.' }),
  });

export const ExportPage = z
  .discriminatedUnion('section', [
    exportPage(
      'profile',
      z.object({ user: Me.shape.user, profile: Me.shape.profile }).openapi('ExportProfile'),
    ),
    exportPage('exercises', Exercise),
    exportPage('routines', Routine),
    exportPage('workouts', WorkoutDetail),
    exportPage('weighIns', WeighIn),
    exportPage('foods', Food),
    exportPage('rotationGroups', RotationGroup),
  ])
  .openapi('ExportPage', {
    description:
      'One page of one section. `profile` has one item; `exercises`, `routines`, `workouts`, ' +
      '`weighIns`, `foods` and `rotationGroups` are cursor-paged. Workouts include ones in ' +
      'progress, and `foods` archived ones.',
  });

export const PlanningExportPage = z
  .discriminatedUnion('section', [
    exportPage('phases', GoalPhase),
    exportPage('dayRoutines', DayRoutine),
    exportPage('planDays', PlanDay),
  ])
  .openapi('PlanningExportPage');
