// S14's goal phase and targets (docs/02 S14, docs/03 §8.2): each default with its source, the
// provisional calories from a formula until the maintenance check is applied, and the day's macros
// from the phase. Local dates are `YYYY-MM-DD` strings.

export type PhaseType = 'cut' | 'bulk' | 'maintain';
export type Sex = 'male' | 'female';

/**
 * A claim the screen tags with its evidence. The key names the entry the web app holds the claim,
 * strength and sources under (`apps/web/src/evidence.tsx`).
 */
export type SourceKey =
  | 'rate_cut'
  | 'rate_bulk'
  | 'protein_g_per_kg'
  | 'fat_pct_calories'
  | 'provisional_calories'
  | 'protein_per_meal'
  | 'carb_timing_training';

/** One default, the range it sits in, and where both come from. */
export type Default = { value: number; range: [number, number]; sourceKey: SourceKey };

/** kcal in a kilogram of bodyweight change, by convention (docs/03 §8.3). */
export const KCAL_PER_KG = 7700;

const round = (value: number, places = 0) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * The defaults for a new phase of `type` (S14). A cut starts at the slow end of 0.5–1% a week and
 * the top of 1.6–2.2 g/kg, because needs rise in a deficit (Helms 2014; Morton 2018); a bulk at the
 * slow end of 0.25–0.5% a week (Iraki 2019) and 1.6 g/kg, Morton's breakpoint. Fat is 25% of
 * calories, inside Helms' 15–30%; carbohydrate is what remains.
 */
export function phaseDefaults(type: PhaseType): {
  targetRatePctPerWeek: Default | null;
  proteinGPerKg: Default;
  fatPctCalories: Default;
} {
  return {
    targetRatePctPerWeek:
      type === 'cut'
        ? { value: 0.5, range: [0.5, 1], sourceKey: 'rate_cut' }
        : type === 'bulk'
          ? { value: 0.25, range: [0.25, 0.5], sourceKey: 'rate_bulk' }
          : null,
    proteinGPerKg: {
      value: type === 'cut' ? 2.2 : 1.6,
      range: [1.6, 2.2],
      sourceKey: 'protein_g_per_kg',
    },
    fatPctCalories: { value: 25, range: [15, 30], sourceKey: 'fat_pct_calories' },
  };
}

/** Whole years from `birthDate` to `today`, both local dates. */
export function ageOn(birthDate: string, today: string): number {
  const [by = 0, bm = 0, bd = 0] = birthDate.split('-').map(Number);
  const [ty = 0, tm = 0, td = 0] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/**
 * The physical activity level a week of `trainingDays` stands for: 1.45 with none, 0.05 more for
 * each, so 1.45 to 1.80, inside FAO/WHO/UNU's sedentary-to-active range of 1.40 to 1.99 (Human
 * energy requirements, 2004, Table 5.3). A desk job with weights is the user this app is for.
 */
export const activityLevel = (trainingDays: number) =>
  round(1.45 + 0.05 * Math.min(7, Math.max(0, trainingDays)), 2);

export type ProvisionalCalories = {
  /** To the nearest 10 kcal. */
  kcal: number;
  /** Resting energy by Mifflin–St Jeor, kcal a day. */
  restingKcal: number;
  activityLevel: number;
  /** The deficit (negative) or surplus for the rate, kcal a day. 0 on maintenance. */
  adjustmentKcal: number;
};

/**
 * S14's provisional calories: resting energy by Mifflin–St Jeor (1990), the equation a systematic
 * review found most often within 10% of measured (Frankenfield 2005), times the activity level, less
 * the deficit or plus the surplus for the phase's rate: rate × bodyweight × 7,700 ÷ 7 a day. It is
 * labelled provisional until the maintenance check is applied (S18a).
 */
export function provisionalCalories(input: {
  type: PhaseType;
  targetRatePctPerWeek: number | null;
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  trainingDaysPerWeek: number;
}): ProvisionalCalories {
  const restingKcal = round(
    10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + (input.sex === 'male' ? 5 : -161),
  );
  const level = activityLevel(input.trainingDaysPerWeek);
  const perDay = ((input.targetRatePctPerWeek ?? 0) / 100) * input.weightKg * (KCAL_PER_KG / 7);
  const adjustmentKcal =
    input.type === 'cut' ? -round(perDay) : input.type === 'bulk' ? round(perDay) : 0;
  return {
    kcal: round((restingKcal * level + adjustmentKcal) / 10) * 10,
    restingKcal,
    activityLevel: level,
    adjustmentKcal,
  };
}

/** The day's targets: calories from the phase, protein per kg, fat a share, carbohydrate the rest. */
export type Targets = { energyKcal: number; proteinG: number; carbG: number; fatG: number };

/** S14: the phase's targets at a bodyweight, protein and fat to the tenth of a gram. */
export function macroTargets(
  phase: { calorieTargetKcal: number; proteinGPerKg: number; fatPctCalories: number },
  weightKg: number,
): Targets {
  const proteinG = round(phase.proteinGPerKg * weightKg, 1);
  const fatG = round((phase.calorieTargetKcal * phase.fatPctCalories) / 100 / 9, 1);
  const carbG = round(Math.max(0, (phase.calorieTargetKcal - proteinG * 4 - fatG * 9) / 4), 1);
  return { energyKcal: phase.calorieTargetKcal, proteinG, carbG, fatG };
}

/** The phase's week number on `today`: week 1 is its first seven days. */
export const phaseWeek = (startedOn: string, today: string) =>
  Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`)) / 604_800_000,
  ) + 1;

/**
 * The bodyweight targets are set at on `today`: the trend once there is one, which a day's swing
 * does not move, else the latest day's weight. Null with no weigh-in on or before `today`.
 */
export function bodyweightForTargets(
  days: { date: string; weightKg: number; trendKg: number | null }[],
  today: string,
): { weightKg: number; date: string } | null {
  const latest = days
    .filter((day) => day.date <= today)
    .toSorted((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (latest === undefined) return null;
  return { weightKg: latest.trendKg ?? latest.weightKg, date: latest.date };
}
