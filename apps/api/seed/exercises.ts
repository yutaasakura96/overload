// The seeded exercise library (S8), hand-written (docs/06, 2026-09-23: no dataset carries an
// increment, a rest default or a rep range, and the permissive ones have bad provenance).
//
// `pnpm --filter @overload/api seed:exercises` writes the seed migrations from this file. The
// migrations are what ship; this file is their source. After a migration has run anywhere, a
// correction is a new migration, not an edit here. So the first 50 rows and `seedMigration()` stay
// as they shipped, and everything since is in `growMigration()` (docs/06, 2026-10-08): one rename,
// a muscle group and aliases for the first 50, and the rows that take the list to about 180.
//
// Names: specification → equipment → exercise ("Incline Dumbbell Bench Press", CONTEXT.md).
// Bodyweight movements carry no equipment word. Increments per equipment class (docs/04):
// barbell 2.5 · dumbbell 1.0 · machine_plate 2.5 · machine_stack 5.0 · cable 2.5 · bodyweight 0.
// A Smith machine loads with the barbell's plates, so it is `machine_plate`.
// Defaults: 6–10 reps and 120 s rest (S3, S5). The heavy barbell lifts rest 180 s; isolation
// work is 10–15 reps with 90 s.
//
// Aliases are the other names a lifter would type ("RDL", "Skullcrusher", "Pec Deck"), which the
// naming rule keeps out of the name. Search matches them; nothing shows them. An alias is not
// needed where every word of it is already in the name.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine_plate'
  | 'machine_stack'
  | 'cable'
  | 'bodyweight';
type Kind = 'heavy' | 'compound' | 'isolation';

const increments: Record<Equipment, number> = {
  barbell: 2.5,
  dumbbell: 1.0,
  machine_plate: 2.5,
  machine_stack: 5.0,
  cable: 2.5,
  bodyweight: 0,
};

const defaults: Record<Kind, { rest: number; repLow: number; repHigh: number }> = {
  heavy: { rest: 180, repLow: 6, repHigh: 10 },
  compound: { rest: 120, repLow: 6, repHigh: 10 },
  isolation: { rest: 90, repLow: 10, repHigh: 15 },
};

const exercises: [name: string, equipment: Equipment, kind: Kind][] = [
  ['Barbell Back Squat', 'barbell', 'heavy'],
  ['Barbell Front Squat', 'barbell', 'heavy'],
  ['Barbell Deadlift', 'barbell', 'heavy'],
  ['Barbell Romanian Deadlift', 'barbell', 'heavy'],
  ['Barbell Bench Press', 'barbell', 'heavy'],
  ['Incline Barbell Bench Press', 'barbell', 'heavy'],
  ['Close Grip Barbell Bench Press', 'barbell', 'compound'],
  ['Barbell Overhead Press', 'barbell', 'heavy'],
  ['Bent Over Barbell Row', 'barbell', 'heavy'],
  ['Barbell Hip Thrust', 'barbell', 'compound'],
  ['Barbell Curl', 'barbell', 'isolation'],
  ['Lying EZ Bar Triceps Extension', 'barbell', 'isolation'],

  ['Dumbbell Bench Press', 'dumbbell', 'compound'],
  ['Incline Dumbbell Bench Press', 'dumbbell', 'compound'],
  ['Seated Dumbbell Shoulder Press', 'dumbbell', 'compound'],
  ['1 Arm Dumbbell Row', 'dumbbell', 'compound'],
  ['Dumbbell Romanian Deadlift', 'dumbbell', 'compound'],
  ['Walking Dumbbell Lunge', 'dumbbell', 'compound'],
  ['Bulgarian Dumbbell Split Squat', 'dumbbell', 'compound'],
  ['Dumbbell Goblet Squat', 'dumbbell', 'compound'],
  ['Dumbbell Lateral Raise', 'dumbbell', 'isolation'],
  ['Dumbbell Rear Delt Fly', 'dumbbell', 'isolation'],
  ['Dumbbell Fly', 'dumbbell', 'isolation'],
  ['Dumbbell Curl', 'dumbbell', 'isolation'],
  ['Dumbbell Hammer Curl', 'dumbbell', 'isolation'],
  ['Overhead Dumbbell Triceps Extension', 'dumbbell', 'isolation'],

  ['Machine Chest Press', 'machine_stack', 'compound'],
  ['Machine Shoulder Press', 'machine_stack', 'compound'],
  ['Chest Supported Machine Row', 'machine_stack', 'compound'],
  ['Machine Chest Fly', 'machine_stack', 'isolation'],
  ['Machine Rear Delt Fly', 'machine_stack', 'isolation'],
  ['Machine Leg Extension', 'machine_stack', 'isolation'],
  ['Seated Machine Leg Curl', 'machine_stack', 'isolation'],
  ['Lying Machine Leg Curl', 'machine_stack', 'isolation'],

  ['Plate-Loaded Leg Press', 'machine_plate', 'compound'],
  ['Plate-Loaded Hack Squat', 'machine_plate', 'compound'],
  ['Plate-Loaded Chest Press', 'machine_plate', 'compound'],
  ['Plate-Loaded Row', 'machine_plate', 'compound'],
  ['Standing Plate-Loaded Calf Raise', 'machine_plate', 'isolation'],

  ['Cable Lat Pulldown', 'cable', 'compound'],
  ['Seated Cable Row', 'cable', 'compound'],
  ['Cable Triceps Pushdown', 'cable', 'isolation'],
  ['Overhead Cable Triceps Extension', 'cable', 'isolation'],
  ['1 Arm Cable Lateral Raise', 'cable', 'isolation'],
  ['Cable Face Pull', 'cable', 'isolation'],
  ['Cable Chest Fly', 'cable', 'isolation'],

  ['Pull-Up', 'bodyweight', 'compound'],
  ['Chin-Up', 'bodyweight', 'compound'],
  ['Parallel Bar Dip', 'bodyweight', 'compound'],
  ['Hanging Leg Raise', 'bodyweight', 'isolation'],
];

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;

export function seedMigration(): string {
  const rows = exercises.map(([name, equipment, kind]) => {
    const d = defaults[kind];
    const increment = increments[equipment].toFixed(2);
    return `  (${quote(name)}, ${quote(equipment)}, ${increment}, ${d.rest}, ${d.repLow}, ${d.repHigh})`;
  });
  return [
    '-- Generated by apps/api/seed/exercises.ts. Do not edit by hand; a correction is a new migration.',
    '-- Custom migration (docs/12 §3): drizzle-kit made the empty file and its journal entry.',
    '',
    'INSERT INTO exercise',
    '  (name, equipment, default_increment_kg, default_rest_seconds, default_rep_low, default_rep_high)',
    'VALUES',
    `${rows.join(',\n')};`,
    '',
  ].join('\n');
}

export const seedMigrationPath = fileURLToPath(
  new URL('../migrations/0003_seed_exercises.sql', import.meta.url),
);

type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core';

/** In-place renames of the first 50, which keep their ids: routines and history follow. */
export const renames: [from: string, to: string][] = [
  // "Chest Fly" as the machine and cable rows already say, and apart from the rear delt fly.
  ['Dumbbell Fly', 'Dumbbell Chest Fly'],
];

/** The first 50, by the name they were seeded under. */
const firstFifty: Record<string, [muscleGroup: MuscleGroup, aliases: string[]]> = {
  'Barbell Back Squat': ['quads', ['High Bar Squat', 'Low Bar Squat']],
  'Barbell Front Squat': ['quads', []],
  'Barbell Deadlift': ['back', ['Conventional Deadlift']],
  'Barbell Romanian Deadlift': ['hamstrings', ['RDL']],
  'Barbell Bench Press': ['chest', ['Flat Bench']],
  'Incline Barbell Bench Press': ['chest', []],
  'Close Grip Barbell Bench Press': ['triceps', ['CGBP']],
  'Barbell Overhead Press': ['shoulders', ['OHP', 'Military Press', 'Shoulder Press']],
  'Bent Over Barbell Row': ['back', []],
  'Barbell Hip Thrust': ['glutes', []],
  'Barbell Curl': ['biceps', ['Biceps Curl']],
  'Lying EZ Bar Triceps Extension': ['triceps', ['Skullcrusher', 'Skull Crusher']],

  'Dumbbell Bench Press': ['chest', []],
  'Incline Dumbbell Bench Press': ['chest', []],
  'Seated Dumbbell Shoulder Press': ['shoulders', ['Seated Dumbbell Overhead Press']],
  '1 Arm Dumbbell Row': ['back', ['Single Arm Dumbbell Row', 'One Arm Dumbbell Row']],
  'Dumbbell Romanian Deadlift': ['hamstrings', ['Dumbbell RDL']],
  'Walking Dumbbell Lunge': ['quads', []],
  'Bulgarian Dumbbell Split Squat': ['quads', ['Rear Foot Elevated Split Squat', 'RFESS']],
  'Dumbbell Goblet Squat': ['quads', []],
  'Dumbbell Lateral Raise': ['shoulders', ['Side Raise']],
  'Dumbbell Rear Delt Fly': ['shoulders', ['Reverse Fly', 'Bent Over Lateral Raise']],
  'Dumbbell Fly': ['chest', ['Dumbbell Flye', 'Pec Fly']],
  'Dumbbell Curl': ['biceps', ['Biceps Curl', 'Alternating Curl']],
  'Dumbbell Hammer Curl': ['biceps', []],
  'Overhead Dumbbell Triceps Extension': ['triceps', ['French Press']],

  'Machine Chest Press': ['chest', ['Seated Chest Press']],
  'Machine Shoulder Press': ['shoulders', ['Machine Overhead Press']],
  'Chest Supported Machine Row': ['back', ['Seated Machine Row', 'Row Machine']],
  'Machine Chest Fly': ['chest', ['Pec Deck', 'Pec Fly', 'Butterfly']],
  'Machine Rear Delt Fly': ['shoulders', ['Reverse Pec Deck', 'Reverse Fly']],
  'Machine Leg Extension': ['quads', ['Quad Extension']],
  'Seated Machine Leg Curl': ['hamstrings', ['Hamstring Curl']],
  'Lying Machine Leg Curl': ['hamstrings', ['Hamstring Curl', 'Prone Leg Curl']],

  'Plate-Loaded Leg Press': ['quads', ['45 Degree Leg Press', 'Sled Leg Press']],
  'Plate-Loaded Hack Squat': ['quads', []],
  'Plate-Loaded Chest Press': ['chest', ['Hammer Strength Chest Press']],
  'Plate-Loaded Row': ['back', ['Hammer Strength Row', 'Iso-Lateral Row']],
  'Standing Plate-Loaded Calf Raise': ['calves', []],

  'Cable Lat Pulldown': ['back', []],
  'Seated Cable Row': ['back', ['Low Row']],
  'Cable Triceps Pushdown': ['triceps', ['Triceps Pressdown']],
  'Overhead Cable Triceps Extension': ['triceps', []],
  '1 Arm Cable Lateral Raise': ['shoulders', ['Single Arm Cable Lateral Raise']],
  'Cable Face Pull': ['shoulders', []],
  'Cable Chest Fly': ['chest', ['Cable Crossover']],

  'Pull-Up': ['back', ['Pullup']],
  'Chin-Up': ['back', ['Chinup']],
  'Parallel Bar Dip': ['triceps', ['Chest Dip', 'Triceps Dip']],
  'Hanging Leg Raise': ['core', []],
};

type Addition = [
  name: string,
  equipment: Equipment,
  kind: Kind,
  muscleGroup: MuscleGroup,
  aliases: string[],
];

/** Added 2026-10-08 (issue #39). Timed holds and carries are left out: a set is weight × reps. */
const additions: Addition[] = [
  ['Decline Barbell Bench Press', 'barbell', 'heavy', 'chest', []],
  ['Decline Dumbbell Bench Press', 'dumbbell', 'compound', 'chest', []],
  ['Dumbbell Floor Press', 'dumbbell', 'compound', 'chest', []],
  ['Incline Dumbbell Chest Fly', 'dumbbell', 'isolation', 'chest', ['Incline Dumbbell Flye']],
  ['Dumbbell Pullover', 'dumbbell', 'isolation', 'chest', []],
  ['Smith Machine Bench Press', 'machine_plate', 'compound', 'chest', []],
  ['Incline Smith Machine Bench Press', 'machine_plate', 'compound', 'chest', []],
  ['Incline Machine Chest Press', 'machine_stack', 'compound', 'chest', []],
  [
    'Incline Plate-Loaded Chest Press',
    'machine_plate',
    'compound',
    'chest',
    ['Hammer Strength Incline Press'],
  ],
  [
    'Decline Plate-Loaded Chest Press',
    'machine_plate',
    'compound',
    'chest',
    ['Hammer Strength Decline Press'],
  ],
  [
    'Low to High Cable Chest Fly',
    'cable',
    'isolation',
    'chest',
    ['Low Cable Crossover', 'Incline Cable Fly'],
  ],
  [
    'High to Low Cable Chest Fly',
    'cable',
    'isolation',
    'chest',
    ['High Cable Crossover', 'Decline Cable Fly'],
  ],
  ['Push-Up', 'bodyweight', 'compound', 'chest', ['Pushup', 'Press-Up']],
  ['Incline Push-Up', 'bodyweight', 'compound', 'chest', ['Incline Pushup']],
  ['Decline Push-Up', 'bodyweight', 'compound', 'chest', ['Decline Pushup', 'Feet Elevated']],

  ['Pendlay Barbell Row', 'barbell', 'heavy', 'back', []],
  ['T-Bar Row', 'barbell', 'compound', 'back', ['Landmine Row']],
  ['Chest Supported T-Bar Row', 'machine_plate', 'compound', 'back', []],
  ['Barbell Rack Pull', 'barbell', 'heavy', 'back', ['Block Pull']],
  ['Deficit Barbell Deadlift', 'barbell', 'heavy', 'back', []],
  ['Barbell Shrug', 'barbell', 'isolation', 'back', ['Trap Shrug']],
  ['Dumbbell Shrug', 'dumbbell', 'isolation', 'back', ['Trap Shrug']],
  ['Smith Machine Shrug', 'machine_plate', 'isolation', 'back', ['Trap Shrug']],
  ['Smith Machine Bent Over Row', 'machine_plate', 'compound', 'back', []],
  ['Chest Supported Dumbbell Row', 'dumbbell', 'compound', 'back', ['Incline Dumbbell Row']],
  ['Bent Over Dumbbell Row', 'dumbbell', 'compound', 'back', []],
  ['Wide Grip Cable Lat Pulldown', 'cable', 'compound', 'back', []],
  ['Close Grip Cable Lat Pulldown', 'cable', 'compound', 'back', ['V-Bar Pulldown']],
  ['Reverse Grip Cable Lat Pulldown', 'cable', 'compound', 'back', ['Underhand', 'Supinated']],
  ['Straight Arm Cable Pulldown', 'cable', 'isolation', 'back', ['Cable Pullover', 'Pushdown']],
  ['1 Arm Seated Cable Row', 'cable', 'compound', 'back', ['Single Arm Seated Cable Row']],
  ['Machine Lat Pulldown', 'machine_stack', 'compound', 'back', []],
  ['Machine Pullover', 'machine_stack', 'isolation', 'back', ['Lat Pullover']],
  ['Machine Back Extension', 'machine_stack', 'isolation', 'back', ['Lower Back Machine']],
  [
    'Plate-Loaded Lat Pulldown',
    'machine_plate',
    'compound',
    'back',
    ['Hammer Strength Pulldown', 'Iso-Lateral Pulldown'],
  ],
  ['Plate-Loaded High Row', 'machine_plate', 'compound', 'back', ['Hammer Strength High Row']],
  ['Plate-Loaded Low Row', 'machine_plate', 'compound', 'back', ['Hammer Strength Low Row']],
  ['Back Extension', 'bodyweight', 'isolation', 'back', ['Hyperextension', 'Roman Chair']],
  ['Wide Grip Pull-Up', 'bodyweight', 'compound', 'back', ['Wide Grip Pullup']],
  ['Neutral Grip Pull-Up', 'bodyweight', 'compound', 'back', ['Neutral Grip Pullup']],
  ['Inverted Row', 'bodyweight', 'compound', 'back', ['Australian Pull-Up', 'Bodyweight Row']],

  ['Seated Barbell Overhead Press', 'barbell', 'heavy', 'shoulders', ['Seated Military Press']],
  ['Barbell Push Press', 'barbell', 'heavy', 'shoulders', []],
  [
    'Standing Dumbbell Shoulder Press',
    'dumbbell',
    'compound',
    'shoulders',
    ['Standing Dumbbell Overhead Press'],
  ],
  ['Dumbbell Arnold Press', 'dumbbell', 'compound', 'shoulders', []],
  ['Dumbbell Front Raise', 'dumbbell', 'isolation', 'shoulders', []],
  ['Barbell Upright Row', 'barbell', 'compound', 'shoulders', []],
  ['Dumbbell Upright Row', 'dumbbell', 'compound', 'shoulders', []],
  ['Machine Lateral Raise', 'machine_stack', 'isolation', 'shoulders', ['Side Raise']],
  [
    'Plate-Loaded Shoulder Press',
    'machine_plate',
    'compound',
    'shoulders',
    ['Hammer Strength Shoulder Press', 'Plate-Loaded Overhead Press'],
  ],
  [
    'Smith Machine Shoulder Press',
    'machine_plate',
    'compound',
    'shoulders',
    ['Smith Machine Overhead Press'],
  ],
  ['Cable Front Raise', 'cable', 'isolation', 'shoulders', []],
  ['Cable Rear Delt Fly', 'cable', 'isolation', 'shoulders', ['Reverse Cable Crossover']],

  ['EZ Bar Curl', 'barbell', 'isolation', 'biceps', ['Biceps Curl']],
  ['EZ Bar Preacher Curl', 'barbell', 'isolation', 'biceps', ['Scott Curl']],
  ['Incline Dumbbell Curl', 'dumbbell', 'isolation', 'biceps', []],
  ['Dumbbell Preacher Curl', 'dumbbell', 'isolation', 'biceps', []],
  ['Dumbbell Concentration Curl', 'dumbbell', 'isolation', 'biceps', []],
  ['Dumbbell Zottman Curl', 'dumbbell', 'isolation', 'biceps', []],
  ['Machine Biceps Curl', 'machine_stack', 'isolation', 'biceps', []],
  ['Machine Preacher Curl', 'machine_stack', 'isolation', 'biceps', []],
  ['Cable Curl', 'cable', 'isolation', 'biceps', ['Cable Biceps Curl']],
  ['Rope Cable Hammer Curl', 'cable', 'isolation', 'biceps', []],
  ['Behind the Body Cable Curl', 'cable', 'isolation', 'biceps', ['Bayesian Curl']],

  ['Overhead EZ Bar Triceps Extension', 'barbell', 'isolation', 'triceps', ['French Press']],
  [
    'Lying Dumbbell Triceps Extension',
    'dumbbell',
    'isolation',
    'triceps',
    ['Dumbbell Skullcrusher', 'Dumbbell Skull Crusher'],
  ],
  ['Dumbbell Triceps Kickback', 'dumbbell', 'isolation', 'triceps', []],
  ['Close Grip Smith Machine Bench Press', 'machine_plate', 'compound', 'triceps', []],
  ['Machine Triceps Extension', 'machine_stack', 'isolation', 'triceps', []],
  ['Machine Dip', 'machine_stack', 'compound', 'triceps', ['Seated Dip']],
  ['Rope Cable Triceps Pushdown', 'cable', 'isolation', 'triceps', ['Rope Pressdown']],
  [
    '1 Arm Cable Triceps Pushdown',
    'cable',
    'isolation',
    'triceps',
    ['Single Arm Cable Triceps Pushdown'],
  ],
  ['Cable Triceps Kickback', 'cable', 'isolation', 'triceps', []],
  ['Bench Dip', 'bodyweight', 'compound', 'triceps', []],
  ['Close Grip Push-Up', 'bodyweight', 'compound', 'triceps', ['Diamond Push-Up', 'Pushup']],

  ['Barbell Wrist Curl', 'barbell', 'isolation', 'forearms', []],
  ['Reverse Barbell Wrist Curl', 'barbell', 'isolation', 'forearms', ['Wrist Extension']],
  ['Reverse Grip Barbell Curl', 'barbell', 'isolation', 'forearms', ['Reverse Curl']],
  ['Dumbbell Wrist Curl', 'dumbbell', 'isolation', 'forearms', []],
  ['Reverse Dumbbell Wrist Curl', 'dumbbell', 'isolation', 'forearms', ['Wrist Extension']],
  ['Cable Wrist Curl', 'cable', 'isolation', 'forearms', []],

  ['Barbell Box Squat', 'barbell', 'heavy', 'quads', []],
  ['Barbell Lunge', 'barbell', 'compound', 'quads', []],
  ['Walking Barbell Lunge', 'barbell', 'compound', 'quads', []],
  ['Dumbbell Lunge', 'dumbbell', 'compound', 'quads', []],
  ['Reverse Dumbbell Lunge', 'dumbbell', 'compound', 'quads', []],
  ['Dumbbell Step-Up', 'dumbbell', 'compound', 'quads', []],
  ['Smith Machine Squat', 'machine_plate', 'compound', 'quads', []],
  ['Smith Machine Split Squat', 'machine_plate', 'compound', 'quads', ['Smith Machine Lunge']],
  [
    '1 Leg Plate-Loaded Leg Press',
    'machine_plate',
    'compound',
    'quads',
    ['Single Leg Plate-Loaded Leg Press'],
  ],
  ['Machine Leg Press', 'machine_stack', 'compound', 'quads', ['Seated Leg Press']],
  [
    '1 Leg Machine Leg Extension',
    'machine_stack',
    'isolation',
    'quads',
    ['Single Leg Machine Leg Extension', 'Quad Extension'],
  ],
  ['Air Squat', 'bodyweight', 'compound', 'quads', ['Bodyweight Squat']],
  ['Pistol Squat', 'bodyweight', 'compound', 'quads', ['Single Leg Squat', '1 Leg Squat']],

  [
    'Stiff Leg Barbell Deadlift',
    'barbell',
    'heavy',
    'hamstrings',
    ['Straight Leg Deadlift', 'SLDL'],
  ],
  ['Barbell Good Morning', 'barbell', 'compound', 'hamstrings', []],
  [
    '1 Leg Dumbbell Romanian Deadlift',
    'dumbbell',
    'compound',
    'hamstrings',
    ['Single Leg Dumbbell Romanian Deadlift', 'Single Leg RDL'],
  ],
  [
    'Smith Machine Romanian Deadlift',
    'machine_plate',
    'compound',
    'hamstrings',
    ['Smith Machine RDL'],
  ],
  ['Lying Plate-Loaded Leg Curl', 'machine_plate', 'isolation', 'hamstrings', ['Hamstring Curl']],
  ['Standing Machine Leg Curl', 'machine_stack', 'isolation', 'hamstrings', ['Hamstring Curl']],
  ['Nordic Hamstring Curl', 'bodyweight', 'isolation', 'hamstrings', []],
  ['Glute Ham Raise', 'bodyweight', 'isolation', 'hamstrings', ['GHR']],

  ['Sumo Barbell Deadlift', 'barbell', 'heavy', 'glutes', []],
  ['Barbell Glute Bridge', 'barbell', 'compound', 'glutes', []],
  ['Plate-Loaded Hip Thrust', 'machine_plate', 'compound', 'glutes', ['Hip Thrust Machine']],
  ['Smith Machine Hip Thrust', 'machine_plate', 'compound', 'glutes', []],
  ['Machine Glute Kickback', 'machine_stack', 'isolation', 'glutes', []],
  ['Machine Hip Abduction', 'machine_stack', 'isolation', 'glutes', ['Abductor', 'Outer Thigh']],
  ['Machine Hip Adduction', 'machine_stack', 'isolation', 'glutes', ['Adductor', 'Inner Thigh']],
  ['Cable Pull Through', 'cable', 'isolation', 'glutes', []],
  ['Cable Glute Kickback', 'cable', 'isolation', 'glutes', ['Cable Donkey Kick']],
  ['Glute Bridge', 'bodyweight', 'isolation', 'glutes', []],

  ['Standing Barbell Calf Raise', 'barbell', 'isolation', 'calves', []],
  ['Standing Dumbbell Calf Raise', 'dumbbell', 'isolation', 'calves', []],
  ['Seated Plate-Loaded Calf Raise', 'machine_plate', 'isolation', 'calves', []],
  ['Plate-Loaded Leg Press Calf Raise', 'machine_plate', 'isolation', 'calves', ['Calf Press']],
  ['Smith Machine Calf Raise', 'machine_plate', 'isolation', 'calves', []],
  ['Standing Machine Calf Raise', 'machine_stack', 'isolation', 'calves', []],
  ['Standing Calf Raise', 'bodyweight', 'isolation', 'calves', ['Bodyweight Calf Raise']],

  ['Crunch', 'bodyweight', 'isolation', 'core', []],
  ['Reverse Crunch', 'bodyweight', 'isolation', 'core', []],
  ['Bicycle Crunch', 'bodyweight', 'isolation', 'core', []],
  ['Sit-Up', 'bodyweight', 'isolation', 'core', ['Situp']],
  ['Decline Sit-Up', 'bodyweight', 'isolation', 'core', ['Decline Situp']],
  ['V-Up', 'bodyweight', 'isolation', 'core', ['Jackknife Sit-Up', 'V Sit-Up']],
  ['Lying Leg Raise', 'bodyweight', 'isolation', 'core', ['Floor Leg Raise']],
  ['Hanging Knee Raise', 'bodyweight', 'isolation', 'core', []],
  ['Toes to Bar', 'bodyweight', 'isolation', 'core', ['T2B']],
  ['Russian Twist', 'bodyweight', 'isolation', 'core', []],
  ['Ab Wheel Rollout', 'bodyweight', 'isolation', 'core', ['Ab Roller']],
  ['Dumbbell Side Bend', 'dumbbell', 'isolation', 'core', []],
  ['Machine Crunch', 'machine_stack', 'isolation', 'core', ['Ab Crunch Machine', 'Ab Machine']],
  ['Machine Torso Rotation', 'machine_stack', 'isolation', 'core', ['Rotary Torso']],
  ['Cable Crunch', 'cable', 'isolation', 'core', []],
  ['Cable Woodchopper', 'cable', 'isolation', 'core', ['Wood Chop', 'Cable Chop']],
];

const renamed = (name: string) => renames.find(([from]) => from === name)?.[1] ?? name;

/** Every seeded exercise as the migrations leave it, in seed order. */
export const seededExercises = [
  ...exercises.map(([name, equipment, kind]) => {
    const tagged = firstFifty[name];
    if (tagged === undefined) throw new Error(`${name} has no muscle group`);
    return { name: renamed(name), equipment, kind, muscleGroup: tagged[0], aliases: tagged[1] };
  }),
  ...additions.map(([name, equipment, kind, muscleGroup, aliases]) => ({
    name,
    equipment,
    kind,
    muscleGroup,
    aliases,
  })),
];

const textArray = (items: string[]) => `ARRAY[${items.map(quote).join(', ')}]::text[]`;

/**
 * A custom exercise that shares a name with a seeded one stays the user's own, history and all
 * (the unique index is per owner, docs/04). It takes the seeded row's muscle group, so the two sit
 * side by side in the library, the user's marked `Yours`.
 */
export const fileCustomNamesakes = [
  'UPDATE exercise AS custom',
  '  SET muscle_group = seeded.muscle_group',
  '  FROM exercise AS seeded',
  '  WHERE custom.owner_user_id IS NOT NULL',
  '    AND custom.muscle_group IS NULL',
  '    AND seeded.owner_user_id IS NULL',
  '    AND lower(custom.name) = lower(seeded.name);',
].join('\n');

export function growMigration(): string {
  const breakpoint = '--> statement-breakpoint';
  const renameStatements = renames.flatMap(([from, to]) => [
    `UPDATE exercise SET name = ${quote(to)}, updated_at = now()`,
    `  WHERE owner_user_id IS NULL AND name = ${quote(from)};`,
    breakpoint,
  ]);
  const tags = seededExercises
    .slice(0, exercises.length)
    .map((e) => `  (${quote(e.name)}, ${quote(e.muscleGroup)}, ${textArray(e.aliases)})`);
  const rows = seededExercises.slice(exercises.length).map((e) => {
    const d = defaults[e.kind];
    const increment = increments[e.equipment].toFixed(2);
    return `  (${quote(e.name)}, ${quote(e.equipment)}, ${increment}, ${d.rest}, ${d.repLow}, ${d.repHigh}, ${quote(e.muscleGroup)}, ${textArray(e.aliases)})`;
  });
  return [
    '-- Generated by apps/api/seed/exercises.ts. Do not edit by hand; a correction is a new migration.',
    '-- Custom migration (docs/12 §3): drizzle-kit made the empty file and its journal entry.',
    '-- Issue #39: the seeded library grows from 50 to about 180. Every existing row keeps its id.',
    '',
    ...renameStatements,
    'UPDATE exercise',
    '  SET muscle_group = tagged.muscle_group, aliases = tagged.aliases',
    '  FROM (VALUES',
    tags.map((tag) => `  ${tag}`).join(',\n'),
    '  ) AS tagged (name, muscle_group, aliases)',
    '  WHERE exercise.owner_user_id IS NULL AND exercise.name = tagged.name;',
    breakpoint,
    'INSERT INTO exercise',
    '  (name, equipment, default_increment_kg, default_rest_seconds, default_rep_low, default_rep_high, muscle_group, aliases)',
    'VALUES',
    `${rows.join(',\n')};`,
    breakpoint,
    fileCustomNamesakes,
    '',
  ].join('\n');
}

export const growMigrationPath = fileURLToPath(
  new URL('../migrations/0011_grow_exercise_library.sql', import.meta.url),
);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(seedMigrationPath, seedMigration());
  writeFileSync(growMigrationPath, growMigration());
}
