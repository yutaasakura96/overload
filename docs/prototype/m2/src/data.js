// Generated sample data for the M2 prototype. Nothing here is real: foods, weigh-ins, batches and
// confirmed days are made up so every screen has something to show (owner, 2026-10-16).

const TODAY = '2026-10-16';
const NOW = { midday: '12:10', evening: '22:05', morning: '07:40' };

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const isoOf = (date) => date.toISOString().slice(0, 10);
const addDays = (iso, n) => isoOf(new Date(toDate(iso).getTime() + n * 86400000));
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

// A small seeded random, so every load draws the same sample data.
let seed = 20261016;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

// ---------------------------------------------------------------- the food list (S12)

// Per 100 g of the state named. Values are close to MEXT's but rounded; they are sample data.
const FOODS = [
  { id: 'chicken', name: 'Chicken breast, skinless', state: 'raw', kcal: 105, p: 23.3, c: 0.1, f: 1.9, fib: 0, source: 'mext', ref: '11220', group: 'protein', keeps: 4, cooked: true },
  { id: 'salmon', name: 'Salmon (chum)', state: 'raw', kcal: 124, p: 22.3, c: 0.1, f: 4.1, fib: 0, source: 'mext', ref: '10134', group: 'protein', keeps: null, cooked: false },
  { id: 'rice', name: 'White rice', state: 'raw', kcal: 342, p: 6.1, c: 77.6, f: 0.9, fib: 0.5, source: 'mext', ref: '01083', group: 'starch', keeps: 3, cooked: true },
  { id: 'potato', name: 'Potato, peeled', state: 'raw', kcal: 59, p: 1.8, c: 17.3, f: 0.1, fib: 1.3, source: 'mext', ref: '02017', group: 'starch', keeps: 5, cooked: true },
  { id: 'oats', name: 'Rolled oats', state: 'raw', kcal: 350, p: 13.7, c: 69.1, f: 5.7, fib: 9.4, source: 'open_food_facts', ref: '4901234567894', group: null, keeps: null, cooked: false },
  { id: 'broccoli', name: 'Broccoli', state: 'raw', kcal: 37, p: 5.4, c: 6.6, f: 0.6, fib: 5.1, source: 'mext', ref: '06263', group: 'greens', keeps: 4, cooked: true },
  { id: 'okra', name: 'Okra', state: 'raw', kcal: 26, p: 2.1, c: 6.6, f: 0.2, fib: 5.0, source: 'mext', ref: '06032', group: 'greens', keeps: null, cooked: false },
  { id: 'beans', name: 'Green beans', state: 'raw', kcal: 23, p: 1.8, c: 5.1, f: 0.1, fib: 2.4, source: 'mext', ref: '06010', group: 'greens', keeps: null, cooked: false },
  { id: 'egg', name: 'Egg, M', state: 'raw', kcal: 142, p: 12.2, c: 0.4, f: 10.2, fib: 0, source: 'mext', ref: '12004', group: null, keeps: null, cooked: false, piece: 55 },
  { id: 'yogurt', name: 'Greek yogurt, plain, 0% fat', brand: 'Meiji', state: 'raw', kcal: 59, p: 10.3, c: 3.6, f: 0.4, fib: 0, source: 'label_photo', ref: null, group: null, keeps: null, cooked: false },
  { id: 'banana', name: 'Banana', state: 'raw', kcal: 93, p: 1.1, c: 22.5, f: 0.2, fib: 1.1, source: 'mext', ref: '07107', group: null, keeps: null, cooked: false, piece: 100 },
  { id: 'whey', name: 'Whey protein, plain', brand: 'Myprotein', state: 'raw', kcal: 400, p: 80, c: 6.7, f: 5, fib: 0, source: 'open_food_facts', ref: '5055534300000', group: null, keeps: null, cooked: false },
  { id: 'oil', name: 'Olive oil', state: 'raw', kcal: 894, p: 0, c: 0, f: 100, fib: 0, source: 'mext', ref: '14001', group: null, keeps: null, cooked: false },
  { id: 'tofu', name: 'Tofu, firm', state: 'raw', kcal: 73, p: 7.0, c: 1.5, f: 4.9, fib: 1.1, source: 'manual', ref: null, group: null, keeps: null, cooked: false },
];

const GROUPS = [
  { id: 'starch', name: 'Starch' },
  { id: 'greens', name: 'Green vegetable' },
  { id: 'protein', name: 'Main protein' },
];

const SOURCE_WORD = { mext: 'MEXT food table', open_food_facts: 'Barcode, Open Food Facts', label_photo: 'Label photo', manual: 'Typed by hand' };

// The MEXT search the add-food screen offers (a few rows of the ~2,500).
const MEXT = [
  { code: '11220', jp: '鶏 若どり むね 皮なし 生', en: 'Chicken breast, skinless, raw', kcal: 105, p: 23.3, c: 0.1, f: 1.9, fib: 0 },
  { code: '11221', jp: '鶏 若どり むね 皮なし 焼き', en: 'Chicken breast, skinless, grilled', kcal: 177, p: 38.8, c: 0, f: 2.5, fib: 0 },
  { code: '11219', jp: '鶏 若どり むね 皮つき 生', en: 'Chicken breast, with skin, raw', kcal: 133, p: 21.3, c: 0.1, f: 5.9, fib: 0 },
  { code: '11224', jp: '鶏 若どり ささみ 生', en: 'Chicken tenderloin, raw', kcal: 98, p: 23.9, c: 0.1, f: 0.8, fib: 0 },
  { code: '11223', jp: '鶏 若どり もも 皮なし 生', en: 'Chicken thigh, skinless, raw', kcal: 113, p: 19.0, c: 0, f: 5.0, fib: 0 },
  { code: '06263', jp: 'ブロッコリー 花序 生', en: 'Broccoli, raw', kcal: 37, p: 5.4, c: 6.6, f: 0.6, fib: 5.1 },
  { code: '06264', jp: 'ブロッコリー 花序 ゆで', en: 'Broccoli, boiled', kcal: 30, p: 3.9, c: 5.2, f: 0.4, fib: 4.3 },
  { code: '01088', jp: 'こめ 水稲めし 精白米', en: 'White rice, cooked', kcal: 156, p: 2.5, c: 37.1, f: 0.3, fib: 1.5 },
  { code: '01083', jp: 'こめ 水稲穀粒 精白米', en: 'White rice, raw', kcal: 342, p: 6.1, c: 77.6, f: 0.9, fib: 0.5 },
  { code: '12004', jp: '鶏卵 全卵 生', en: 'Egg, whole, raw', kcal: 142, p: 12.2, c: 0.4, f: 10.2, fib: 0 },
];

// ---------------------------------------------------------------- batches (S13)

const BATCHES = [
  { id: 'b1', food: 'chicken', raw: 1400, cooked: 1050, on: '2026-10-11' },
  { id: 'b2', food: 'rice', raw: 600, cooked: 1680, on: '2026-10-14' },
  { id: 'b3', food: 'potato', raw: 800, cooked: 720, on: '2026-10-04' },
  { id: 'b4', food: 'chicken', raw: 1200, cooked: 912, on: '2026-10-04' },
  { id: 'b5', food: 'rice', raw: 900, cooked: 2475, on: '2026-10-07' },
  { id: 'b6', food: 'chicken', raw: 1500, cooked: 1110, on: '2026-09-27' },
];

// ---------------------------------------------------------------- goal phase, targets, routine (S14, S15)

const PROFILE = { weightKg: 82.4, heightCm: 176, sex: 'male', age: 31, timezone: 'Asia/Tokyo' };
const PHASE = { type: 'cut', started: '2026-09-04', ratePct: 0.5, proteinPerKg: 2.2, fatPct: 27, kcal: 2350, basis: 'provisional_formula' };
const ROUTINE = {
  training: { wake: '06:30', workStart: '09:30', workEnd: '18:00', train: '18:30', bed: '23:00', meals: 5 },
  rest: { wake: '07:30', workStart: '09:30', workEnd: '18:00', train: null, bed: '23:00', meals: 4 },
  weekdays: [1, 2, 4, 5],
};

// ---------------------------------------------------------------- today's plan (S16)

// Grams are the planner's output: cooked weight for batch-cooked foods, whole pieces for eggs.
const PLAN_TODAY = [
  { id: 'm1', time: '07:00', label: 'Breakfast', items: [['egg', 3, 'pc'], ['oats', 30], ['yogurt', 150], ['banana', 1, 'pc']] },
  { id: 'm2', time: '12:00', label: 'Lunch', items: [['chicken', 120, 'cooked'], ['rice', 160, 'cooked'], ['broccoli', 120, 'cooked'], ['oil', 20]] },
  { id: 'm3', time: '16:30', label: 'Before training', carbs: true, items: [['rice', 220, 'cooked'], ['chicken', 75, 'cooked'], ['banana', 1, 'pc']] },
  { id: 'm4', time: '19:45', label: 'After training', carbs: true, items: [['potato', 300, 'cooked'], ['chicken', 110, 'cooked'], ['okra', 100], ['oil', 15]] },
  { id: 'm5', time: '21:30', label: 'Evening', items: [['yogurt', 150], ['oats', 25], ['egg', 1, 'pc']] },
];

const PLAN_CAPPED = PLAN_TODAY.map((meal) => ({
  ...meal,
  items: meal.items.map(([id, qty, unit]) => [id, meal.id === 'm3' && id === 'rice' ? 100 : meal.id === 'm4' && id === 'potato' ? 100 : qty, unit]),
}));

// The rest-day plan, four meals, no workout in the day.
const PLAN_REST = [
  { id: 'r1', time: '08:00', label: 'Breakfast', items: [['egg', 3, 'pc'], ['oats', 80], ['yogurt', 150]] },
  { id: 'r2', time: '12:30', label: 'Lunch', items: [['chicken', 130, 'cooked'], ['rice', 300, 'cooked'], ['beans', 120], ['oil', 15]] },
  { id: 'r3', time: '17:00', label: 'Afternoon', items: [['yogurt', 200], ['whey', 25], ['banana', 1, 'pc']] },
  { id: 'r4', time: '20:00', label: 'Dinner', items: [['salmon', 150], ['potato', 400, 'cooked'], ['broccoli', 150, 'cooked'], ['oil', 20]] },
];

const ROUTINES = [
  { id: 'push-a', name: 'Push A', exercises: 5, sets: 17, last: '2026-10-12' },
  { id: 'pull-a', name: 'Pull A', exercises: 5, sets: 16, last: '2026-10-13' },
  { id: 'legs-a', name: 'Legs A', exercises: 4, sets: 14, last: '2026-10-15' },
];

// ---------------------------------------------------------------- the coming week's prep (S13, S17)

const WEEK = { start: '2026-10-19', cookDays: ['2026-10-18', '2026-10-22'] };

// Each cook: which day, raw grams, and the plan days the batch covers (keeps_days from the cook day).
const PREP = [
  { day: 0, food: 'chicken', raw: 1400, covers: ['2026-10-19', '2026-10-21'] },
  { day: 0, food: 'rice', raw: 600, covers: ['2026-10-19', '2026-10-20'] },
  { day: 0, food: 'potato', raw: 700, covers: ['2026-10-19', '2026-10-22'] },
  { day: 0, food: 'broccoli', raw: 700, covers: ['2026-10-19', '2026-10-21'] },
  { day: 1, food: 'chicken', raw: 1850, covers: ['2026-10-22', '2026-10-25'] },
  { day: 1, food: 'rice', raw: 900, covers: ['2026-10-22', '2026-10-24'] },
  { day: 1, food: 'broccoli', raw: 350, covers: ['2026-10-22', '2026-10-25'] },
];

// Foods eaten raw or cooked on the day, bought for the week but not batch-cooked.
const WEEK_RAW = [
  ['egg', 21, 'pc'],
  ['oats', 640],
  ['yogurt', 3150],
  ['banana', 9, 'pc'],
  ['okra', 600],
  ['beans', 360],
  ['whey', 175],
  ['salmon', 360],
  ['oil', 90],
];

// ---------------------------------------------------------------- weigh-ins and complete days (S11, S18a)

// Sixty days of morning weigh-ins drifting down, with gaps, a few late readings and a few typed.
const WEIGH_INS = [];
{
  let level = 84.6;
  for (let i = 59; i >= 0; i -= 1) {
    const date = addDays(TODAY, -i);
    level -= 0.035 + (rand() - 0.5) * 0.02;
    if (rand() < 0.12 && i > 1) continue;
    const late = rand() < 0.08 && i > 0;
    const typed = !late && rand() < 0.07;
    const kg = Math.round((level + (rand() - 0.5) * 0.9) * 10) / 10;
    const hour = late ? 19 + Math.floor(rand() * 3) : 6 + Math.floor(rand() * 2);
    const minute = Math.floor(rand() * 60);
    WEIGH_INS.push({ id: `w${i}`, date, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, kg, morning: !late, source: typed ? 'manual' : 'apple_health' });
  }
}

// The days the phase has seen, and whether each was complete. The newest 14 hold 12 complete.
const DAY_LOG = [];
{
  const incomplete = new Set(['2026-10-10', '2026-10-13', '2026-09-20', '2026-09-27', '2026-09-28', '2026-09-14']);
  for (let d = PHASE.started; d < TODAY; d = addDays(d, 1)) {
    const complete = !incomplete.has(d) && d >= '2026-09-10';
    DAY_LOG.push({ date: d, complete, kcal: complete ? Math.round(2330 + (rand() - 0.5) * 220) : null });
  }
}
