import { z } from '@hono/zod-openapi';

// Response schemas shared by the routes. These generate packages/api-contract (docs/03 §2).

export const Uuid = z.uuid().openapi({ example: '0192a001-7c1e-7a33-9c2d-4b6f1e0a9d11' });

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
