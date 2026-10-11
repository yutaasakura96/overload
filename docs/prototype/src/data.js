// Sample data for the prototype: one year of Push / Pull / Legs, generated from a strength curve
// per exercise and the app's own double-progression rule, so every screen reads the same workouts.
const TODAY = '2026-10-10';
const DAY = 86400000;
const GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core'];
const SPLITS = {
  push: ['chest', 'shoulders', 'triceps'],
  pull: ['back', 'biceps', 'forearms'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves'],
  core: ['core'],
};

// curve: [weeks ago, e1RM in kg]. since: weeks ago the exercise was first done.
const EXERCISES = [
  { id: 'bench', name: 'Barbell Bench Press', group: 'chest', sec: ['triceps', 'shoulders'], lo: 6, hi: 10, inc: 2.5, rest: 180, curve: [[52, 91], [30, 100], [12, 105.5], [5, 109.6], [0, 109.6]] },
  { id: 'dbpress', name: 'Seated Dumbbell Shoulder Press', group: 'shoulders', sec: ['triceps'], lo: 6, hi: 10, inc: 1, rest: 120, curve: [[52, 24], [26, 28], [12, 30.5], [0, 33.4]] },
  { id: 'incline', name: 'Incline Dumbbell Bench Press', group: 'chest', sec: ['shoulders', 'triceps'], lo: 6, hi: 10, inc: 1, rest: 120, curve: [[52, 30], [20, 36.5], [12, 37.6], [4, 37.6], [0, 38.9]] },
  { id: 'lateral', name: '1 Arm Cable Lateral Raise', group: 'shoulders', sec: [], lo: 10, hi: 15, inc: 2.5, rest: 90, since: -1, curve: [[0, 12]] },
  { id: 'pushdown', name: 'Cable Triceps Pushdown', group: 'triceps', sec: [], lo: 10, hi: 15, inc: 2.5, rest: 90, curve: [[52, 36], [12, 44], [0, 47.5]] },
  { id: 'row', name: 'Bent Over Barbell Row', group: 'back', sec: ['biceps'], lo: 6, hi: 10, inc: 2.5, rest: 180, curve: [[52, 76], [22, 90], [12, 90.5], [4, 86], [0, 83.5]] },
  { id: 'pulldown', name: 'Cable Lat Pulldown', group: 'back', sec: ['biceps'], lo: 6, hi: 10, inc: 2.5, rest: 120, curve: [[52, 70], [12, 82], [0, 86.5]] },
  { id: 'cablerow', name: 'Seated Cable Row', group: 'back', sec: ['biceps'], lo: 6, hi: 10, inc: 2.5, rest: 120, curve: [[52, 80], [0, 80.8]] },
  { id: 'facepull', name: 'Cable Face Pull', group: 'shoulders', sec: [], lo: 10, hi: 15, inc: 2.5, rest: 90, curve: [[52, 26], [26, 30.4], [0, 30.4]] },
  { id: 'curl', name: 'Dumbbell Curl', group: 'biceps', sec: [], lo: 10, hi: 15, inc: 1, rest: 90, curve: [[52, 18.4], [26, 17.3], [0, 18.3]] },
  { id: 'squat', name: 'Barbell Back Squat', group: 'quads', sec: ['glutes'], lo: 6, hi: 10, inc: 2.5, rest: 180, curve: [[52, 108], [26, 124], [12, 131], [0, 139.5]] },
  { id: 'legpress', name: 'Plate-Loaded Leg Press', group: 'quads', sec: ['glutes'], lo: 6, hi: 10, inc: 2.5, rest: 120, curve: [[52, 180], [12, 222], [0, 233]] },
  { id: 'legext', name: 'Machine Leg Extension', group: 'quads', sec: [], lo: 10, hi: 15, inc: 5, rest: 90, curve: [[52, 78], [20, 90.5], [0, 91]] },
  { id: 'legcurl', name: 'Seated Machine Leg Curl', group: 'hamstrings', sec: [], lo: 10, hi: 15, inc: 5, rest: 90, since: 9, curve: [[9, 60], [5, 66], [0, 61.5]] },
  // In the library, never logged: what the suggestions and the filter draw on.
  { id: 'rdl', name: 'Barbell Romanian Deadlift', group: 'hamstrings', sec: ['glutes'], lo: 6, hi: 10, inc: 2.5, rest: 180, since: -1, curve: [[0, 90]] },
  { id: 'calf', name: 'Standing Plate-Loaded Calf Raise', group: 'calves', sec: [], lo: 10, hi: 15, inc: 2.5, rest: 90, since: -1, curve: [[0, 80]] },
  { id: 'legraise', name: 'Hanging Leg Raise', group: 'core', sec: [], lo: 10, hi: 15, inc: 0, rest: 90, since: -1, curve: [[0, 0]] },
  { id: 'hipthrust', name: 'Barbell Hip Thrust', group: 'glutes', sec: ['hamstrings'], lo: 6, hi: 10, inc: 2.5, rest: 120, since: -1, curve: [[0, 100]] },
  { id: 'inclinebb', name: 'Incline Barbell Bench Press', group: 'chest', sec: ['shoulders', 'triceps'], lo: 6, hi: 10, inc: 2.5, rest: 180, since: -1, curve: [[0, 90]] },
  { id: 'tbar', name: 'Chest Supported Dumbbell Row', group: 'back', sec: ['biceps'], lo: 6, hi: 10, inc: 1, rest: 120, since: -1, curve: [[0, 30]] },
  { id: 'hammer', name: 'Dumbbell Hammer Curl', group: 'biceps', sec: ['forearms'], lo: 10, hi: 15, inc: 1, rest: 90, since: -1, curve: [[0, 16]] },
  { id: 'ohp', name: 'Barbell Overhead Press', group: 'shoulders', sec: ['triceps'], lo: 6, hi: 10, inc: 2.5, rest: 180, since: -1, curve: [[0, 55]] },
];
const exById = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

const ROUTINES = [
  { id: 'push-a', name: 'Push A', slots: [['bench', 4], ['dbpress', 3], ['incline', 3], ['lateral', 3], ['pushdown', 3]] },
  { id: 'pull-a', name: 'Pull A', slots: [['row', 4], ['pulldown', 3], ['cablerow', 3], ['facepull', 3], ['curl', 3]] },
  { id: 'legs-a', name: 'Legs A', slots: [['squat', 4], ['legpress', 3], ['legext', 3], ['legcurl', 3]] },
];
// Monday push, Wednesday pull, Friday legs, Saturday push again.
const WEEK = { 1: 'push-a', 3: 'pull-a', 5: 'legs-a', 6: 'push-a' };

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (isoDate, days) => iso(new Date(toDate(isoDate).getTime() + days * DAY));
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
const weeksAgo = (isoDate) => daysBetween(isoDate, TODAY) / 7;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function interp(curve, wk) {
  if (wk >= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i += 1) {
    const [w0, v0] = curve[i - 1];
    const [w1, v1] = curve[i];
    if (wk >= w1) return v0 + ((v1 - v0) * (w0 - wk)) / (w0 - w1);
  }
  return curve.at(-1)[1];
}

const epley = (w, r) => w * (1 + r / 30);
const roundTo = (value, step) => Math.round(value / step) * step;

function generate() {
  const workouts = [];
  const weight = {};
  let setSeq = 0;
  for (let day = 364; day >= 1; day -= 1) {
    const date = addDays(TODAY, -day);
    const routineId = WEEK[toDate(date).getUTCDay()];
    if (routineId === undefined) continue;
    if (day > 14 && hash(`skip${date}`) < 0.09) continue;
    const routine = ROUTINES.find((r) => r.id === routineId);
    const wk = day / 7;
    const exercises = [];
    for (const [exId, target] of routine.slots) {
      const ex = exById[exId];
      if ((ex.since ?? 52.1) < wk) continue;
      const capacity = interp(ex.curve, wk) * (1 + (hash(`${exId}${date}`) - 0.5) * 0.045);
      let w = weight[exId] ?? Math.floor(capacity / (1 + (ex.lo + 2) / 30) / ex.inc) * ex.inc;
      const reps = (kg, i) => Math.floor(30 * ((capacity * (1 - 0.016 * i)) / kg - 1) + 1e-6);
      for (let guard = 0; guard < 4 && reps(w, 0) < ex.lo; guard += 1) w -= ex.inc;
      const sets = [];
      if (exercises.length === 0 && ex.inc === 2.5 && ex.lo === 6) {
        sets.push({ id: `s${(setSeq += 1)}`, w: roundTo(w * 0.5, 2.5), r: 10, rir: null, warm: true });
        sets.push({ id: `s${(setSeq += 1)}`, w: roundTo(w * 0.75, 2.5), r: 5, rir: null, warm: true });
      }
      for (let i = 0; i < target; i += 1) {
        const could = reps(w, i);
        const r = Math.max(1, Math.min(ex.hi, could));
        // RIR was only recorded from the summer on.
        sets.push({ id: `s${(setSeq += 1)}`, w, r, rir: wk < 14 ? Math.max(0, Math.min(4, could - r)) : null, warm: false });
      }
      exercises.push({ exId, target, sets });
      weight[exId] = sets.filter((s) => !s.warm).every((s) => s.r >= ex.hi) ? w + ex.inc : w;
    }
    const setCount = exercises.reduce((n, e) => n + e.sets.length, 0);
    const minute = 20 + Math.floor(hash(`t${date}`) * 30);
    workouts.push({
      id: `w${date}`,
      date,
      start: `18:${String(minute).padStart(2, '0')}`,
      minutes: Math.round(setCount * 3.1 + hash(`m${date}`) * 8),
      routineId,
      name: routine.name,
      exercises,
    });
  }
  return workouts;
}

const DB = { workouts: generate(), routines: ROUTINES.map((r) => ({ ...r })) };

// ---- Derived views. Every one reads DB.workouts, so an edit in history shows up everywhere. ----
const working = (sets) => sets.filter((s) => !s.warm);

// So the workout screen has one target that goes up: last Monday every shoulder-press set reached 10.
for (const set of working(DB.workouts.findLast((w) => w.routineId === 'push-a').exercises.find((e) => e.exId === 'dbpress').sets)) {
  set.r = 10;
  set.rir = 1;
}

/** The workouts holding an exercise, oldest first, each with its working sets and e1RM. */
function exerciseHistory(exId) {
  const out = [];
  for (const workout of DB.workouts) {
    const entry = workout.exercises.find((e) => e.exId === exId);
    const sets = entry === undefined ? [] : working(entry.sets);
    if (sets.length === 0) continue;
    const best = sets.reduce((a, b) => (epley(b.w, b.r) > epley(a.w, a.r) ? b : a));
    const top = sets.reduce((a, b) => (b.w > a.w || (b.w === a.w && b.r > a.r) ? b : a));
    out.push({ workout, sets, e1rm: epley(best.w, best.r), top, volume: sets.reduce((n, s) => n + s.w * s.r, 0) });
  }
  return out;
}

/** Last time (CONTEXT.md): the working sets of the most recent workout holding the exercise. */
function lastTime(exId) {
  const last = exerciseHistory(exId).at(-1);
  return last === undefined ? null : { date: last.workout.date, workoutId: last.workout.id, sets: last.sets };
}

/** The suggestion (S3): plus the increment when every working set reached the top of the range. */
function suggestion(exId) {
  const ex = exById[exId];
  const last = lastTime(exId);
  if (last === null) return null;
  const w = last.sets.at(-1).w;
  const hit = last.sets.every((s) => s.r >= ex.hi);
  return { weight: hit ? w + ex.inc : w, up: hit, from: w };
}

const SPAN_WEEKS = { '4w': 4, '12w': 12, '6m': 26, '1y': 52, all: 520 };
const inSpan = (history, span) => history.filter((p) => weeksAgo(p.workout.date) <= SPAN_WEEKS[span]);

/** A lift's trend over a span: the least-squares line through its e1RM points, end against start. */
function trend(exId, span) {
  const points = inSpan(exerciseHistory(exId), span);
  if (points.length < 3) return { points, status: 'none' };
  const xs = points.map((p) => -weeksAgo(p.workout.date));
  const ys = points.map((p) => p.e1rm);
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  const slope = xs.reduce((n, x, i) => n + (x - mx) * (ys[i] - my), 0) / xs.reduce((n, x) => n + (x - mx) ** 2, 0);
  const start = my + slope * (xs[0] - mx);
  const end = my + slope * (xs.at(-1) - mx);
  const pct = ((end - start) / start) * 100;
  return { points, start, end, kg: end - start, pct, status: pct >= 2 ? 'gaining' : pct <= -2 ? 'losing' : 'holding', latest: ys.at(-1) };
}

function strengthOverview(span) {
  const rows = EXERCISES.map((ex) => ({ ex, ...trend(ex.id, span) })).filter((row) => row.points.length > 0);
  const rated = rows.filter((row) => row.status !== 'none');
  const overall = rated.length === 0 ? null : rated.reduce((n, row) => n + row.pct, 0) / rated.length;
  return { rows, rated, overall };
}

const RANGE = { low: 10, high: 20 };

/** Weekly working sets per muscle group. A set counts whole for the exercise's group, half for a secondary one. */
function balance(mode, extraWorkouts = []) {
  const weekStart = addDays(TODAY, -((toDate(TODAY).getUTCDay() + 6) % 7));
  const from = mode === 'week' ? weekStart : addDays(TODAY, -27);
  const weeks = mode === 'week' ? 1 : 4;
  const rows = Object.fromEntries(GROUPS.map((g) => [g, { group: g, direct: 0, indirect: 0, from: {} }]));
  for (const workout of [...DB.workouts, ...extraWorkouts]) {
    if (workout.date < from) continue;
    for (const entry of workout.exercises) {
      const ex = exById[entry.exId];
      const n = working(entry.sets).length / weeks;
      if (n === 0) continue;
      rows[ex.group].direct += n;
      rows[ex.group].from[ex.name] = (rows[ex.group].from[ex.name] ?? 0) + n;
      for (const g of ex.sec) {
        rows[g].indirect += n / 2;
        rows[g].from[`${ex.name} (half)`] = (rows[g].from[`${ex.name} (half)`] ?? 0) + n / 2;
      }
    }
  }
  return GROUPS.map((g) => {
    const row = rows[g];
    const total = row.direct + row.indirect;
    const status = total === 0 ? 'none' : total < RANGE.low ? 'low' : total > RANGE.high ? 'high' : 'in';
    return { ...row, total, status };
  });
}

if (typeof module !== 'undefined') module.exports = { DB, EXERCISES, exById, lastTime, suggestion, strengthOverview, balance, exerciseHistory, trend };
