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

export const Profile = z
  .object({
    timezone: z.string().openapi({ example: 'Asia/Tokyo' }),
    heightCm: z.number().nullable(),
    sex: z.enum(['male', 'female']).nullable(),
    birthDate: z.iso.date().nullable(),
    trainingWeekdays: z
      .array(z.int().min(1).max(7))
      .openapi({ description: 'ISO weekdays, 1 = Monday.' }),
  })
  .openapi('Profile');

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
