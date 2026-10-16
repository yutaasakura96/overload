// The M2 clickable prototype: plain functions that return each screen's HTML from one state object.
// Nothing here is product code. Class names are the app's own (apps/web/src/styles.css) where a part
// exists already; the new parts are in proto.css and named for the screen they belong to.

const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayLabel = (iso, day = true) => {
  const d = toDate(iso);
  return `${day ? `${DAYS[d.getUTCDay()]} ` : ''}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const weekday = (iso) => DAYS_LONG[toDate(iso).getUTCDay()];
const n0 = (v) => Math.round(v).toLocaleString('en-US');
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const signed = (v, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// docs/05 §6: the four icons.
const icon = (path, size, color, stroke) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const check = (size = 15, color = 'currentColor') => icon('<path d="M4 12.5 9.5 18 20 6.5"/>', size, color, size < 15 ? 3 : 2.5);
const info = (size = 14, color = 'var(--flag)') =>
  `<span class="notice__icon" style="display:inline-flex">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 17h.01"/>', size, color, 2)}</span>`;
const chevron = (direction = 'forward') => {
  const turn = { back: 0, up: 90, forward: 180, down: 270 }[direction];
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${turn}deg)"><path d="M15 5 8 12l7 7"/></svg>`;
};
const swap = (size = 13) => icon('<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>', size, 'currentColor', 2);

// ---------------------------------------------------------------- state

const S = {
  screen: 'today',
  stack: [],
  clock: 'midday',
  offline: false,
  shortfall: false,
  generating: false,
  setup: { profile: true, foods: true, phase: true, routine: true },
  days: {},
  open: null,
  eodDay: null,
  eodLeft: {},
  adjust: null,
  replace: null,
  foodTab: 'prep',
  foodQ: '',
  addQ: '',
  emptyFoods: false,
  foodId: null,
  scan: 'found',
  label: 'read',
  labelStep: 'aim',
  candidate: null,
  prepDone: {},
  groceryDone: {},
  batch: null,
  progTab: 'weight',
  weightSpan: '30',
  weightData: 'full',
  maint: 'ready',
  applied: null,
  weigh: null,
  route: 'hae',
  routeState: 'never',
  token: false,
  phaseForm: null,
  routineForm: null,
  routineDay: 'training',
  sheet: null,
  flash: '',
};

// ---------------------------------------------------------------- derived numbers

const food = (id) => FOODS.find((f) => f.id === id);
const batchesOf = (id) => BATCHES.filter((b) => b.food === id).sort((a, b) => (a.on < b.on ? 1 : -1));
const currentBatch = (id) => batchesOf(id)[0] ?? null;
const yieldOf = (id) => {
  const b = currentBatch(id);
  return b === null ? null : b.cooked / b.raw;
};
// MEXT's boiled values, used for a cooked portion when no batch was weighed (docs/02 Empty states).
const APPROX = { broccoli: { kcal: 30, p: 3.9, c: 5.2, f: 0.4, fib: 4.3 } };

function itemMacros([id, qty, unit]) {
  const f = food(id);
  let grams = unit === 'pc' ? qty * f.piece : qty;
  let per = f;
  let approx = false;
  if (unit === 'cooked') {
    const y = yieldOf(id);
    if (y === null) {
      per = APPROX[id] ?? f;
      approx = true;
    } else grams /= y;
  }
  const k = grams / 100;
  return { kcal: per.kcal * k, p: per.p * k, c: per.c * k, f: per.f * k, fib: per.fib * k, approx };
}
const sum = (list) => list.reduce((t, m) => ({ kcal: t.kcal + m.kcal, p: t.p + m.p, c: t.c + m.c, f: t.f + m.f, fib: t.fib + m.fib }), { kcal: 0, p: 0, c: 0, f: 0, fib: 0 });
const mealMacros = (meal) => sum(meal.items.map(itemMacros));

const TARGETS = (() => {
  const p = Math.round(PHASE.proteinPerKg * PROFILE.weightKg);
  const f = Math.round((PHASE.kcal * PHASE.fatPct) / 100 / 9);
  return { kcal: PHASE.kcal, p, f, c: Math.round((PHASE.kcal - p * 4 - f * 9) / 4), fib: 35 };
})();

// The day on screen follows the prototype's clock: midday and evening are Friday, a training day;
// the next morning is Saturday, a rest day, with Friday as yesterday.
const YESTERDAY_ISO = TODAY;
const dayIso = () => (S.clock === 'morning' ? addDays(TODAY, 1) : TODAY);
const planFor = (iso) => (iso === TODAY ? PLAN_TODAY : PLAN_REST);
const isTraining = (iso) => planFor(iso) === PLAN_TODAY;
const nowTime = () => NOW[S.clock];

function statusesFor(iso) {
  if (S.days[iso] === undefined) {
    const init = {};
    for (const meal of planFor(iso)) init[meal.id] = 'planned';
    if (iso === TODAY) {
      init.m1 = 'as_planned';
      if (S.clock !== 'midday') {
        init.m2 = 'as_planned';
        init.m3 = 'adjusted';
      }
    }
    S.days[iso] = init;
  }
  return S.days[iso];
}
const unconfirmed = (iso) => planFor(iso).filter((m) => statusesFor(iso)[m.id] === 'planned');
const nextDue = (iso) => unconfirmed(iso)[0] ?? null;

function dayTotals(iso) {
  const st = statusesFor(iso);
  const planned = sum(planFor(iso).map(mealMacros));
  let shown = planned;
  if (S.shortfall && iso === dayIso()) shown = { ...planned, p: planned.p - 24, kcal: planned.kcal - 70 };
  const eaten = sum(planFor(iso).filter((m) => ['as_planned', 'adjusted', 'replaced'].includes(st[m.id])).map(mealMacros));
  return { planned: shown, eaten };
}

// The trend (docs/03 §8.3): a time-aware EWMA at 10% a day over the daily weights.
function trendSeries(list) {
  const out = [];
  let prev = null;
  for (const w of list) {
    if (prev === null) out.push({ ...w, trend: w.kg });
    else {
      const a = 1 - 0.9 ** daysBetween(prev.date, w.date);
      out.push({ ...w, trend: prev.trend + a * (w.kg - prev.trend) });
    }
    prev = out.at(-1);
  }
  return out;
}
const weighIns = () => (S.weightData === 'none' ? [] : S.weightData === 'few' ? WEIGH_INS.slice(-2) : WEIGH_INS);
const trendAt = (series, iso) => series.filter((w) => w.date <= iso).at(-1)?.trend ?? series[0]?.trend;

function maintenance() {
  const series = trendSeries(WEIGH_INS);
  const from = addDays(TODAY, -14);
  const window = DAY_LOG.filter((d) => d.date >= from);
  const complete = window.filter((d) => d.complete);
  const intake = complete.reduce((t, d) => t + d.kcal, 0) / complete.length;
  const start = trendAt(series, addDays(from, -1));
  const end = series.at(-1).trend;
  const perWeek = ((end - start) / 14) * 7;
  const kcal = intake - ((end - start) / 14) * 7700;
  return { intake, perWeek, kcal, inWindow: complete.length, total: DAY_LOG.filter((d) => d.complete).length, recent: DAY_LOG.slice(-7).filter((d) => d.complete).length };
}

// ---------------------------------------------------------------- shared parts

function dataState() {
  if (S.offline) return '<output class="data-state">OFFLINE · FROM 07:12</output>';
  return `<output class="data-state"><span class="data-state__dot" aria-hidden="true"></span>SYNCED ${S.clock === 'evening' ? '22:01' : S.clock === 'morning' ? '07:38' : '12:08'}</output>`;
}

function appBar({ title, subline, back = false }) {
  return `<header class="app-bar app-bar--sticky m2-bar${back ? ' app-bar--back' : ''}">
    <div class="app-bar__lead">
      ${back ? `<button type="button" class="app-bar__back" data-act="back">${chevron('back')}<span class="visually-hidden">Back</span></button>` : ''}
      <div><h1 class="app-bar__title">${esc(title)}</h1>${subline === undefined ? '' : `<div class="app-bar__subline">${subline}</div>`}</div>
    </div>${dataState()}</header>`;
}

// Five tabs, as approved at the review (Q1, 2026-10-16).
function tabs(current) {
  const list = [['today', 'Today'], ['food', 'Food'], ['progress', 'Progress'], ['routines', 'Routines'], ['exercises', 'Exercises']];
  return `<nav class="tabs m2-tabs" aria-label="Sections">${list
    .map(([id, label]) => `<button type="button" class="tabs__tab" data-act="tab" data-tab="${id}"${id === current ? ' aria-current="page"' : ''}>${label}</button>`)
    .join('')}</nav>`;
}

function segments(items, current, act, extra = '') {
  return `<div class="segments m2-seg ${extra}" role="group" style="--n:${items.length}">${items
    .map(([id, label]) => `<button type="button" class="segments__segment" data-act="${act}" data-id="${id}" aria-pressed="${id === current}">${label}</button>`)
    .join('')}</div>`;
}

const flash = () => (S.flash === '' ? '' : `<p class="m2-flash" role="status">${check(13, 'var(--done)')}<span>${S.flash}</span></p>`);
const protoNote = (text) => `<p class="proto-note">${text}</p>`;

function field({ label, key, value = '', unit, note, mono = true, placeholder = '', error = '', type = 'text', mode }) {
  const err = error ? `<div class="field__error" role="alert">${info(12, 'var(--error)')}<span class="field__error-word">Refused</span><span>${esc(error)}</span></div>` : '';
  return `<div class="field${mono ? ' field--number' : ''}${error ? ' field--refused' : ''}"><div class="field__label-row"><label class="field__label" for="f-${key}">${label}</label>${note ? `<span class="field__note">${note}</span>` : ''}</div>
    <div class="field__figure"><input id="f-${key}" class="field__input${mono ? ' field__input--number' : ''}" type="${type}" ${mode ? `inputmode="${mode}"` : mono ? 'inputmode="decimal"' : ''} autocomplete="off" data-field="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}">${unit ? `<span class="field__unit" aria-hidden="true">${unit}</span>` : ''}</div>${err}</div>`;
}

const STRENGTH_CLASS = { STRONG: ' evidence--strong', MODERATE: '', CONTESTED: ' evidence--contested' };
function evidenceTag(claim, sheet, strength = 'MODERATE') {
  return `<button type="button" class="evidence${STRENGTH_CLASS[strength]}" data-act="sheet" data-id="${sheet}"><span>${claim}</span><span class="evidence__divider"></span><span class="evidence__strength">${strength}</span><span class="visually-hidden">: open the sources</span></button>`;
}

const SHEETS = {
  carbs: {
    tag: 'MORE CARBS AROUND TRAINING',
    strength: 'MODERATE',
    claim: 'Putting more of the day’s carbohydrate in the meals before and after training can help you train and recover.',
    means:
      'Moderate: the effect is clearest for long or twice-a-day training. For one weights workout a day, the day’s total matters more than the timing, so the plan moves carbohydrate towards training without changing the total.',
    sources: [
      ['International Society of Sports Nutrition position stand: nutrient timing', 'Kerksick et al. · J Int Soc Sports Nutr · 2017'],
      ['Nutrient timing revisited: is there a post-exercise anabolic window?', 'Aragon & Schoenfeld · J Int Soc Sports Nutr · 2013'],
    ],
  },
  protein: {
    tag: '0.4–0.55 G/KG A MEAL',
    strength: 'MODERATE',
    claim: 'Spreading protein over at least four meals, at 0.4 to 0.55 g per kg each, makes the most of it for muscle.',
    means: 'Moderate: drawn from short studies of muscle protein synthesis after a meal. The number of meals does not change fat loss at equal calories (Schoenfeld 2015); it is recommended for protein only.',
    sources: [
      ['How much protein can the body use in a single meal for muscle-building?', 'Schoenfeld & Aragon · J Int Soc Sports Nutr · 2018'],
      ['Effects of meal frequency on weight loss and body composition: a meta-analysis', 'Schoenfeld, Aragon & Krieger · Nutr Rev · 2015'],
    ],
  },
  rate: {
    tag: '0.5–1% A WEEK',
    strength: 'MODERATE',
    claim: 'Losing 0.5 to 1% of bodyweight a week keeps more muscle on a cut than losing faster.',
    means: 'Moderate: a review of studies in lean, trained people. The slower end suits a cut that is already lean.',
    sources: [['Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation', 'Helms, Aragon & Fitschen · J Int Soc Sports Nutr · 2014']],
  },
  proteinkg: {
    tag: '1.6–2.2 G/KG',
    strength: 'STRONG',
    claim: 'Protein of 1.6 g per kg of bodyweight a day, up to about 2.2, supports muscle gain from training.',
    means: 'Strong: a meta-analysis of 49 trials. On a cut, needs rise, so the default is the top of the range.',
    sources: [
      ['A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains', 'Morton et al. · Br J Sports Med · 2018'],
      ['A systematic review of dietary protein during caloric restriction in resistance trained lean athletes', 'Helms et al. · Int J Sport Nutr Exerc Metab · 2014'],
    ],
  },
};

function sheet() {
  if (S.sheet === null) return '';
  if (S.sheet === 'apply') return applySheet();
  const s = SHEETS[S.sheet];
  return `<div class="sheet-scrim" data-act="sheetClose"><div class="sheet" role="dialog" aria-label="Evidence" data-act="noop">
    <div class="sheet__head"><h2 class="section-label">Evidence</h2><button type="button" class="sheet__close" data-act="sheetClose">CLOSE</button></div>
    <div><span class="evidence${STRENGTH_CLASS[s.strength]}" style="pointer-events:none"><span>${s.tag}</span><span class="evidence__divider"></span><span class="evidence__strength">${s.strength}</span></span></div>
    <p class="sheet__claim">${s.claim}</p><p class="sheet__means">${s.means}</p>
    <div><h3 class="section-label">Sources</h3><ul class="sheet__sources">${s.sources.map(([t, m]) => `<li><button type="button" class="m2-source" data-act="noop"><span class="sheet__source-title">${t}</span><span class="sheet__source-meta">${m}</span></button></li>`).join('')}</ul></div></div></div>`;
}

// ---------------------------------------------------------------- Today, the whole day (Q7; screen 3)

const STATUS_WORD = { as_planned: 'Eaten as planned', adjusted: 'Eaten, adjusted', replaced: 'Replaced', skipped: 'Skipped' };

function foodRows(meal, dim = false) {
  return `<ul class="meal__foods${dim ? ' meal__foods--dim' : ''}">${meal.items
    .map((item) => {
      const [id, qty, unit] = item;
      const f = food(id);
      const amount = unit === 'pc' ? `${qty}<span class="meal__unit"> ${qty === 1 ? 'piece' : 'pieces'}</span>` : `${qty}<span class="meal__unit"> g</span>`;
      const approx = unit === 'cooked' && yieldOf(id) === null;
      return `<li class="meal__food"><span class="meal__food-name">${esc(f.name)}${unit === 'cooked' ? `<span class="meal__qual"> cooked${approx ? ', approx.' : ''}</span>` : ''}</span><span class="meal__grams">${amount}</span></li>`;
    })
    .join('')}</ul>`;
}

function mealCard(iso, meal, { active }) {
  const st = statusesFor(iso)[meal.id];
  const m = mealMacros(meal);
  const confirmed = st !== 'planned';
  const open = S.open === meal.id || (S.open === null && active);
  const macroLine = `<span class="meal__macros">${n0(m.kcal)} kcal · ${n0(m.p)} g protein</span>`;
  const tag = meal.carbs && !confirmed ? `<div class="meal__tag">${evidenceTag('MORE CARBS', 'carbs')}</div>` : '';
  const right = confirmed ? `<span class="meal__done">${st === 'skipped' ? '' : check(13, 'var(--done)')}${STATUS_WORD[st]}</span>` : open ? '' : macroLine;
  const head = `<div class="meal__head"><span class="meal__title">${esc(meal.label)}</span>${right}</div>`;
  if (!open) {
    return `<button type="button" class="meal meal--${confirmed ? 'confirmed' : 'planned'}" data-act="openMeal" data-id="${meal.id}">${head}${foodRows(meal, true)}</button>${tag ? `<div class="meal__tag-row">${tag}</div>` : ''}`;
  }
  const disabled = S.offline ? ' disabled' : '';
  const actions = confirmed
    ? `<div class="meal__actions meal__actions--change"><span class="meal__change-note">Confirmed. Changing it replaces this, never adds to it.</span><button type="button" class="button button--secondary" data-act="adjustOpen" data-id="${meal.id}"${disabled}>Adjust</button><button type="button" class="button button--secondary" data-act="replaceOpen" data-id="${meal.id}"${disabled}>Replaced</button><button type="button" class="button button--tertiary" data-act="unconfirm" data-id="${meal.id}"${disabled}>Undo</button></div>`
    : `<div class="meal__actions"><button type="button" class="button button--primary meal__eaten" data-act="eaten" data-id="${meal.id}"${disabled}>${check(18)}Eaten as planned</button>
        <div class="meal__more"><button type="button" class="button button--secondary" data-act="adjustOpen" data-id="${meal.id}"${disabled}>Adjust</button><button type="button" class="button button--secondary" data-act="replaceOpen" data-id="${meal.id}"${disabled}>${swap()}Replaced</button><button type="button" class="button button--secondary" data-act="skip" data-id="${meal.id}"${disabled}>Skipped</button></div>
        ${S.offline ? `<p class="meal__offline">${info(12)}Confirming needs a connection. Nothing is lost: the meal waits as planned.</p>` : ''}</div>`;
  return `<div class="meal meal--${confirmed ? 'confirmed' : 'active'} meal--open">${head}${confirmed ? '' : `<div class="meal__sub">${macroLine}${meal.carbs ? evidenceTag('MORE CARBS', 'carbs') : ''}</div>`}${foodRows(meal)}${actions}</div>`;
}

function timeline(iso) {
  const plan = planFor(iso);
  const st = statusesFor(iso);
  const due = nextDue(iso);
  const entries = plan.map((meal) => ({ time: meal.time, meal }));
  if (isTraining(iso)) entries.push({ time: ROUTINE.training.train, workout: true });
  entries.sort((a, b) => (a.time < b.time ? -1 : 1));
  return `<ol class="timeline">${entries
    .map((e, i) => {
      const last = i === entries.length - 1;
      if (e.workout) {
        const routine = ROUTINES[0];
        return `<li class="timeline__entry timeline__entry--workout"><div class="timeline__rail"><span class="timeline__time">${e.time}</span><span class="timeline__square"></span>${last ? '' : '<span class="timeline__line"></span>'}</div>
          <div class="workout-slot"><div class="workout-slot__text"><span class="workout-slot__label">Workout</span><span class="workout-slot__name">${routine.name}</span><span class="workout-slot__meta">${routine.exercises} exercises · ${routine.sets} sets · last done ${dayLabel(routine.last)}</span></div>
          <button type="button" class="button button--primary workout-slot__go" data-act="startWorkout">Start</button></div></li>`;
      }
      const s = st[e.meal.id];
      const marker = s !== 'planned' ? 'done' : due?.id === e.meal.id ? 'active' : 'future';
      return `<li class="timeline__entry"><div class="timeline__rail"><span class="timeline__time">${e.time}</span><span class="timeline__dot timeline__dot--${marker}"></span>${last ? '' : '<span class="timeline__line"></span>'}</div>
        <div class="timeline__body">${mealCard(iso, e.meal, { active: due?.id === e.meal.id })}</div></li>`;
    })
    .join('')}</ol>`;
}

function meter(label, value, target, unit = 'g') {
  const pct = Math.min(100, (value / target) * 100);
  const diff = Math.round(value - target);
  const word = Math.abs(diff) <= 2 ? 'on target' : diff > 0 ? `${diff} ${unit} over` : `${-diff} ${unit} to go`;
  return `<div class="macro"><div class="macro__head"><span class="macro__label">${label}</span><span class="macro__value">${n0(value)}<span class="macro__of"> / ${n0(target)}</span></span></div>
    <div class="macro__track"><span class="macro__fill" style="width:${pct}%"></span></div><span class="macro__word">${word}</span></div>`;
}

function dayTotalsBlock(iso) {
  const { planned, eaten } = dayTotals(iso);
  const t = TARGETS;
  const off = ((planned.kcal - t.kcal) / t.kcal) * 100;
  return `<section class="totals" aria-label="The day's totals">
    <div class="totals__row"><div><span class="totals__kcal">${n0(planned.kcal)}</span><span class="totals__of"> of ${n0(t.kcal)} kcal planned</span></div>
      <span class="totals__off${Math.abs(off) > 5 ? ' totals__off--flag' : ''}">${signed(off)}%</span></div>
    <div class="totals__eaten">Eaten so far: <b>${n0(eaten.kcal)} kcal</b>, ${n0(eaten.p)} g protein</div>
    <div class="macros">${meter('Protein', planned.p, t.p)}${meter('Carbs', planned.c, t.c)}${meter('Fat', planned.f, t.f)}${meter('Fiber', planned.fib, t.fib)}</div></section>`;
}

function eodCard() {
  if (S.clock === 'evening') {
    const left = unconfirmed(TODAY);
    if (left.length === 0 || S.eodLeft[TODAY]) return '';
    return `<button type="button" class="eod-card" data-act="eodOpen" data-id="${TODAY}"><span class="eod-card__count">${left.length}</span><span class="eod-card__text"><span class="eod-card__title">${plural(left.length, 'meal')} not confirmed yet</span><span class="eod-card__meta">Bedtime is 23:00. Check the day before you sleep.</span></span>${chevron()}</button>`;
  }
  if (S.clock === 'morning') {
    const left = unconfirmed(YESTERDAY_ISO);
    if (left.length === 0 || S.eodLeft[YESTERDAY_ISO]) return '';
    return `<button type="button" class="eod-card" data-act="eodOpen" data-id="${YESTERDAY_ISO}"><span class="eod-card__count">${left.length}</span><span class="eod-card__text"><span class="eod-card__title">Yesterday: ${plural(left.length, 'meal')} not confirmed</span><span class="eod-card__meta">Friday ${dayLabel(YESTERDAY_ISO, false)}. Confirm them or leave the day incomplete.</span></span>${chevron()}</button>`;
  }
  return '';
}

function setupStep() {
  const st = S.setup;
  if (!st.profile)
    return { title: 'First, a little about you', body: 'Your height, sex and birth date set the starting calories, and your weight sets protein. Asked once.', act: 'profileOpen', label: 'Add your details' };
  if (!st.foods)
    return { title: 'The plan is built from your foods', body: 'Add the foods you eat, starting with a protein source. The planner only ever plans from your list.', act: 'addFood', label: 'Add a food' };
  if (!st.phase)
    return { title: 'Set your goal phase', body: 'Cut, maintain or bulk, and how fast. That sets your daily calories and protein, each default with its source.', act: 'phaseOpen', label: 'Set your goal' };
  if (!st.routine)
    return { title: 'Tell the plan your day', body: 'Wake time, work hours, training days and time, and bedtime. The plan cannot place meals without them.', act: 'routineOpen', label: 'Set your day' };
  return null;
}

function startList(iso) {
  const others = isTraining(iso) && setupStep() === null ? ROUTINES.slice(1) : ROUTINES;
  const label = setupStep() !== null ? 'Start a workout' : isTraining(iso) ? 'Or start another workout' : 'Rest day. Start a workout anyway';
  return `<section class="today__section"><h2 class="section-label">${label}</h2><ul class="starts">${others
    .map((r) => `<li><button type="button" class="starts__row" data-act="startWorkout"><span class="routines__text"><span class="routines__name">${r.name}</span><span class="routines__meta">${r.exercises} EXERCISES · ${r.sets} SETS</span><span class="routines__preview">Last done ${dayLabel(r.last)}</span></span><span class="starts__go">START</span></button></li>`)
    .join('')}</ul></section>`;
}

function planRows() {
  return `<section class="today__section"><h2 class="section-label">Your plan</h2>
    <button type="button" class="link-row link-row--flush" data-act="phaseOpen"><span><span class="link-row__name">Cut since ${dayLabel(PHASE.started, false)} · week 7</span><span class="link-row__meta">${n0(TARGETS.kcal)} kcal, provisional · ${TARGETS.p} g protein</span></span>${chevron()}</button>
    <button type="button" class="link-row link-row--flush" data-act="routineOpen"><span><span class="link-row__name">Your day</span><span class="link-row__meta">Training days ${ROUTINE.training.meals} meals · rest days ${ROUTINE.rest.meals} meals</span></span>${chevron()}</button></section>`;
}

function todayScreen() {
  const iso = dayIso();
  const step = setupStep();
  const sub = `${dayLabel(iso).toUpperCase()} · ${isTraining(iso) ? 'TRAINING DAY' : 'REST DAY'}`;
  if (step !== null) {
    const done = ['profile', 'foods', 'phase', 'routine'].filter((k) => S.setup[k]).length;
    return `<main class="m2">${appBar({ title: 'Today', subline: dayLabel(iso).toUpperCase() })}${tabs('today')}
      <section class="empty-state"><span class="m2-step">STEP ${done + 1} OF 4 · YOUR MEAL PLAN</span><h2 class="empty-state__title">${step.title}</h2><p class="empty-state__body">${step.body}</p>
      <button type="button" class="button button--primary" data-act="${step.act}">${step.label}</button></section>
      <ol class="m2-steps">${[['profile', 'About you'], ['foods', 'Your foods'], ['phase', 'Goal phase'], ['routine', 'Your day']]
        .map(([k, l]) => `<li class="m2-steps__item${S.setup[k] ? ' m2-steps__item--done' : ''}">${S.setup[k] ? check(13, 'var(--done)') : '<span class="m2-steps__ring"></span>'}${l}</li>`)
        .join('')}</ol>
      ${startList(iso)}</main>`;
  }
  if (S.generating) {
    return `<main class="m2">${appBar({ title: 'Today', subline: sub })}${tabs('today')}<div class="totals totals--skeleton" aria-busy="true"><span class="skeleton skeleton--figure"></span><span class="skeleton"></span></div>
      <p class="m2-generating" role="status">Making today’s plan from your foods…</p>${[1, 2, 3, 4].map(() => '<div class="skeleton-row"><span class="skeleton skeleton--time"></span><span class="skeleton skeleton--card"></span></div>').join('')}</main>`;
  }
  const shortfall = S.shortfall
    ? `<div class="notice notice--flag m2-notice" role="note">${info()}<div><span class="notice__word" style="color:var(--flag)">Protein 22 g short</span><p>Your foods can’t reach ${TARGETS.p} g today without going over calories, so the plan stops at 159 g. Nothing else was padded to hide it.</p><button type="button" class="button button--secondary" data-act="addFood">Add a protein source</button></div></div>`
    : '';
  return `<main class="m2">${appBar({ title: 'Today', subline: sub })}${tabs('today')}${flash()}
    <div class="m2-stick">${dayTotalsBlock(iso)}</div>${shortfall}${eodCard()}
    ${S.offline ? `<div class="notice notice--flag m2-notice">${info()}<span>Offline. This is the plan as it was at 07:12. Confirming meals waits for a connection; a workout still works offline.</span></div>` : ''}
    <section class="today__section today__section--timeline"><h2 class="section-label">The day</h2>${timeline(iso)}</section>
    ${startList(iso)}${planRows()}</main>`;
}

// ---------------------------------------------------------------- adjust and replace (S18)

function adjustScreen() {
  const meal = planFor(S.adjust.iso).find((m) => m.id === S.adjust.mealId);
  const items = S.adjust.items;
  const before = mealMacros(meal);
  const after = sum(items.map(itemMacros));
  return `<main class="m2">${appBar({ title: `Adjust ${meal.label}`, subline: `${meal.time} · ${dayLabel(S.adjust.iso).toUpperCase()}`, back: true })}
    <p class="m2-lede">Change the grams, or swap a food for one in its rotation group. Saving confirms the meal as eaten, adjusted.</p>
    <ul class="adjust">${items
      .map(([id, qty, unit], i) => {
        const f = food(id);
        const group = f.group === null ? [] : FOODS.filter((x) => x.group === f.group && x.id !== id);
        const step = unit === 'pc' ? 1 : 5;
        return `<li class="adjust__row"><div class="adjust__food"><span class="adjust__name">${esc(f.name)}</span><span class="adjust__meta">${unit === 'cooked' ? 'cooked weight' : unit === 'pc' ? 'whole pieces' : 'as weighed'}</span>
          ${group.length ? `<div class="adjust__swaps">${group.map((g) => `<button type="button" class="adjust__swap" data-act="adjustSwap" data-i="${i}" data-id="${g.id}">${swap(12)}${esc(g.name)}</button>`).join('')}</div>` : ''}</div>
          <div class="stepper"><button type="button" class="stepper__btn" data-act="adjustStep" data-i="${i}" data-d="${-step}" aria-label="Less ${esc(f.name)}">−</button><span class="stepper__value">${qty}<span class="stepper__unit">${unit === 'pc' ? ' pc' : ' g'}</span></span><button type="button" class="stepper__btn" data-act="adjustStep" data-i="${i}" data-d="${step}" aria-label="More ${esc(f.name)}">+</button></div></li>`;
      })
      .join('')}</ul>
    ${S.adjust.refused ? `<div class="notice notice--error m2-notice" role="alert">${info(14, 'var(--error)')}<div><span class="notice__word" style="color:var(--error)">Refused</span><p>Chicken breast at 0 g isn’t a portion. Remove it with Replaced instead. The meal stays as planned.</p></div></div>` : ''}
    <section class="adjust__sum"><div class="adjust__sum-row"><span>This meal</span><span class="adjust__sum-fig">${n0(before.kcal)} → <b>${n0(after.kcal)}</b> kcal</span></div><div class="adjust__sum-row"><span>Protein</span><span class="adjust__sum-fig">${n0(before.p)} → <b>${n0(after.p)}</b> g</span></div></section>
    <div class="section-actions"><button type="button" class="button button--primary" data-act="adjustSave">${check(18)}Save as eaten, adjusted</button><button type="button" class="button button--tertiary" data-act="back">Cancel</button></div></main>`;
}

function replaceScreen() {
  const r = S.replace;
  const meal = planFor(r.iso).find((m) => m.id === r.mealId);
  const picked = r.picked.map(([id, g]) => `<li class="replace__picked"><span>${esc(food(id).name)}</span><span class="meal__grams">${g}<span class="meal__unit"> g</span></span><button type="button" class="button button--tertiary replace__remove" data-act="replaceDrop" data-id="${id}">Remove</button></li>`).join('');
  const body =
    r.mode === 'list'
      ? `<div class="m2-field-wrap">${field({ label: 'Search your foods', key: 'replaceQ', value: r.q, mono: false, placeholder: 'Salmon, tofu…' })}</div>
        <ul class="pick">${FOODS.filter((f) => f.name.toLowerCase().includes(r.q.toLowerCase()))
          .slice(0, 6)
          .map((f) => `<li><button type="button" class="pick__row" data-act="replacePick" data-id="${f.id}"><span class="pick__name">${esc(f.name)}</span><span class="pick__meta">${f.kcal} kcal · ${f.p} g protein per 100 g</span><span class="pick__add">ADD 100 G</span></button></li>`)
          .join('')}</ul>
        ${picked ? `<section class="today__section"><h2 class="section-label">Eaten instead</h2><ul class="replace__list">${picked}</ul></section>` : ''}`
      : `<div class="form">${field({ label: 'What it was', key: 'handName', mono: false, placeholder: 'Ramen at the station' })}
          <div class="form__pair">${field({ label: 'Calories', key: 'hk', unit: 'kcal', placeholder: '0' })}${field({ label: 'Protein', key: 'hp', unit: 'g', placeholder: '0' })}</div>
          <div class="form__pair">${field({ label: 'Carbs', key: 'hc', unit: 'g', placeholder: '0' })}${field({ label: 'Fat', key: 'hf', unit: 'g', placeholder: '0' })}</div>
          <p class="m2-hint">Your own numbers, saved as typed. A photo or a short description arrives in M3.</p></div>`;
  return `<main class="m2">${appBar({ title: `Replace ${meal.label}`, subline: `${meal.time} · ${dayLabel(r.iso).toUpperCase()}`, back: true })}
    <p class="m2-lede">What did you eat instead? From your foods, or by hand.</p>
    <div class="m2-seg-wrap">${segments([['list', 'From my foods'], ['hand', 'By hand']], r.mode, 'replaceMode')}</div>${body}
    <div class="section-actions"><button type="button" class="button button--primary" data-act="replaceSave">${check(18)}Save as replaced</button></div></main>`;
}

// ---------------------------------------------------------------- end-of-day check (screen 4)

function eodScreen() {
  const iso = S.eodDay;
  const left = unconfirmed(iso);
  const { planned } = dayTotals(iso);
  const m = maintenance();
  const when = iso === TODAY && S.clock === 'evening' ? `${dayLabel(iso).toUpperCase()} · 22:05` : `${dayLabel(iso).toUpperCase()} · YESTERDAY`;
  if (left.length === 0) {
    return `<main class="m2 eod">${appBar({ title: 'End of day', subline: when, back: true })}<section class="empty-state"><h2 class="empty-state__title">${check(15, 'var(--done)')} Every meal is confirmed</h2><p class="empty-state__body">${dayLabel(iso)} is a complete day. It counts towards the maintenance check: ${m.total + 1} complete days this phase.</p><button type="button" class="button button--primary" data-act="back">Back to Today</button></section></main>`;
  }
  return `<main class="m2 eod">${appBar({ title: 'End of day', subline: when, back: true })}
    <section class="eod__head"><span class="eod__count">${left.length}</span><span class="eod__words">${left.length === 1 ? 'meal is' : 'meals are'} not confirmed</span></section>
    <div class="notice notice--flag m2-notice">${info()}<span>If you leave ${left.length === 1 ? 'it' : 'them'}, the day is <b style="color:var(--flag);font-weight:400">incomplete</b>: it stays out of the maintenance check, and nothing is counted as eaten.</span></div>
    <section class="today__section"><h2 class="section-label">Not confirmed</h2><ul class="eod__list">${left
      .map((meal) => {
        const mm = mealMacros(meal);
        return `<li class="eod-meal"><div class="eod-meal__head"><span class="eod-meal__time">${meal.time}</span><span class="eod-meal__title">${esc(meal.label)}</span><span class="eod-meal__kcal">${n0(mm.kcal)} kcal</span></div>${foodRows(meal, true)}
          <div class="eod-meal__actions"><button type="button" class="button button--secondary" data-act="eodEaten" data-id="${meal.id}">${check(14)}As planned</button><button type="button" class="button button--secondary" data-act="adjustOpen" data-id="${meal.id}" data-day="${iso}">Adjust</button><button type="button" class="button button--secondary" data-act="replaceOpen" data-id="${meal.id}" data-day="${iso}">Replaced</button><button type="button" class="button button--secondary" data-act="eodSkip" data-id="${meal.id}">Skipped</button></div></li>`;
      })
      .join('')}</ul></section>
    <section class="eod__if"><h2 class="section-label">If you confirm them all</h2><div class="eod__if-grid"><div><span class="eod__if-fig">${n0(planned.kcal)}<span class="eod__if-of"> / ${n0(TARGETS.kcal)}</span></span><span class="eod__if-label">kcal eaten</span></div><div><span class="eod__if-fig">${n0(planned.p)}<span class="eod__if-of"> / ${TARGETS.p}</span></span><span class="eod__if-label">g protein</span></div></div>
      <div class="eod__if-days"><span>Complete days this phase</span><span class="eod__if-fig eod__if-fig--small">${m.total} → ${m.total + 1}</span></div></section>
    <div class="eod__actions"><button type="button" class="button button--primary eod__all" data-act="eodAll">${check(20)}Confirm all as planned</button><button type="button" class="button button--tertiary eod__leave" data-act="eodLeave">Leave day incomplete</button></div></main>`;
}

// ---------------------------------------------------------------- the Food tab (Q7)

const foodTabs = () => segments([['prep', 'Prep'], ['grocery', 'Grocery'], ['foods', 'Foods'], ['batches', 'Batches']], S.foodTab, 'foodTab', 'm2-seg--sub');

function yieldNote(id) {
  const f = food(id);
  const b = currentBatch(id);
  const keeps = `Keeps ${f.keeps} days.`;
  if (b === null) return { text: `No batch weighed yet, so cooked amounts are approximate (MEXT’s boiled values). ${keeps}`, flag: true, weigh: true };
  const age = daysBetween(b.on, TODAY);
  const y = Math.round((b.cooked / b.raw) * 100);
  if (age > 7) return { text: `Yield ${y}% from your batch of ${dayLabel(b.on, false)}, ${age} days ago. Weigh this week’s batch. ${keeps}`, flag: true, weigh: true };
  return { text: `Yield ${y}% from your batch of ${dayLabel(b.on, false)}. ${keeps}`, flag: false };
}

function prepScreen() {
  const days = WEEK.cookDays;
  const section = (dayIndex) => {
    const rows = PREP.filter((p) => p.day === dayIndex);
    const iso = days[dayIndex];
    const coverText = dayIndex === 0 ? 'Covers Monday to Wednesday' : 'Covers Thursday to Sunday';
    return `<section class="cook"><div class="cook__head m2-stick-sub"><div><span class="cook__day">${weekday(iso)} ${dayLabel(iso, false)}</span><span class="cook__which">${dayIndex === 0 ? 'First cook day' : 'Second cook day'}</span></div>
        <div class="cook__cols"><span>Raw</span><span>Cooked</span><span class="visually-hidden">Done</span></div></div>
      <p class="cook__covers">${coverText}${dayIndex === 1 ? '. Chicken keeps 4 days, so Sunday’s batch runs out after Wednesday.' : '.'}</p>
      <ul class="cook__rows">${rows
        .map((p) => {
          const f = food(p.food);
          const y = yieldOf(p.food);
          const note = yieldNote(p.food);
          const key = `${dayIndex}-${p.food}`;
          const done = S.prepDone[key];
          const cooked = y === null ? `≈ ${n0(p.raw * 0.92)}` : n0(p.raw * y);
          const covers = `${weekday(p.covers[0]).slice(0, 3)} ${toDate(p.covers[0]).getUTCDate()} to ${weekday(p.covers[1]).slice(0, 3)} ${toDate(p.covers[1]).getUTCDate()}`;
          return `<li class="cook__row${done ? ' cook__row--done' : ''}"><div class="cook__food"><span class="cook__name">${esc(f.name)}</span><span class="cook__note${note.flag ? ' cook__note--flag' : ''}">${note.text}</span><span class="cook__span">For ${covers}</span></div>
            <span class="cook__raw">${n0(p.raw)}<span class="cook__unit"> g</span></span><span class="cook__cooked">${cooked}</span>
            <button type="button" class="check-cell cook__check${done ? ' check-cell--done' : ''}" data-act="prepTick" data-id="${key}" aria-pressed="${!!done}" aria-label="${esc(f.name)} cooked">${check(15, done ? 'var(--done)' : 'var(--line-control)')}</button></li>`;
        })
        .join('')}</ul></section>`;
  };
  return `<main class="m2">${appBar({ title: 'Food', subline: `PREP FOR THE WEEK OF ${dayLabel(WEEK.start, false).toUpperCase()}` })}${tabs('food')}<div class="m2-seg-wrap">${foodTabs()}</div>${flash()}
    <p class="m2-lede">Raw grams to cook, worked out from next week’s plan and each food’s last weighed batch. Shop and cook by the raw figure.</p>
    ${section(0)}${section(1)}
    <section class="today__section"><h2 class="section-label">Not batch-cooked</h2><p class="m2-hint">Okra and green beans are cooked on the day, by the meal’s grams. Rice keeps 3 days, so Wednesday and Sunday use potato from the same rotation group.</p></section>
    <button type="button" class="link-row" data-act="foodTab" data-id="grocery"><span><span class="link-row__name">Grocery list</span><span class="link-row__meta">${groceryItems().length} items, raw weight, both cook days summed</span></span>${chevron()}</button>
    <footer class="footnote footnote--m2"><span>Next week’s plan, made Fri 16 Oct</span><span class="footnote__formula">7 days · 2 cook days</span></footer></main>`;
}

function groceryItems() {
  const cooked = {};
  for (const p of PREP) cooked[p.food] = (cooked[p.food] ?? 0) + p.raw;
  return [
    ...Object.entries(cooked).map(([id, g]) => ({ id, qty: g, unit: 'g', note: PREP.filter((p) => p.food === id).length > 1 ? PREP.filter((p) => p.food === id).map((p) => n0(p.raw)).join(' + ') + ' for two cooks' : 'for the first cook', cook: true })),
    ...WEEK_RAW.map(([id, qty, unit]) => ({ id, qty, unit: unit ?? 'g', note: 'for the week', cook: false })),
  ];
}

function groceryScreen() {
  const items = groceryItems();
  const left = items.filter((i) => !S.groceryDone[i.id]).length;
  const row = (i) => {
    const done = S.groceryDone[i.id];
    return `<li><button type="button" class="grocery__row${done ? ' grocery__row--done' : ''}" data-act="groceryTick" data-id="${i.id}" aria-pressed="${!!done}"><span class="check-cell grocery__check${done ? ' check-cell--done' : ''}">${check(15, done ? 'var(--done)' : 'var(--line-control)')}</span>
      <span class="grocery__text"><span class="grocery__name">${esc(food(i.id).name)}</span><span class="grocery__note">${i.note}</span></span><span class="grocery__qty">${i.unit === 'pc' ? i.qty : n0(i.qty)}<span class="grocery__unit">${i.unit === 'pc' ? ' pieces' : ' g'}</span></span></button></li>`;
  };
  return `<main class="m2">${appBar({ title: 'Food', subline: `GROCERY FOR THE WEEK OF ${dayLabel(WEEK.start, false).toUpperCase()}` })}${tabs('food')}<div class="m2-seg-wrap">${foodTabs()}</div>
    <div class="grocery__count"><span><b>${left}</b> of ${items.length} left to buy</span><span class="grocery__basis">RAW WEIGHT</span></div>
    <section class="today__section"><h2 class="section-label">For the cook days</h2><ul class="grocery">${items.filter((i) => i.cook).map(row).join('')}</ul></section>
    <section class="today__section"><h2 class="section-label">For the week</h2><ul class="grocery">${items.filter((i) => !i.cook).map(row).join('')}</ul></section>
    <div class="section-actions">${Object.keys(S.groceryDone).length ? '<button type="button" class="button button--tertiary" data-act="groceryClear">Clear the ticks</button>' : ''}</div>
    <footer class="footnote footnote--m2"><span>Ticks stay on this phone</span><span class="footnote__formula">${items.length} items</span></footer></main>`;
}

function foodsScreen() {
  const q = S.foodQ.trim().toLowerCase();
  if (S.emptyFoods) {
    return `<main class="m2">${appBar({ title: 'Food', subline: 'YOUR FOODS' })}${tabs('food')}<div class="m2-seg-wrap">${foodTabs()}</div>
      <section class="empty-state"><h2 class="empty-state__title">No foods yet</h2><p class="empty-state__body">The meal plan is built only from your foods. Add the ones you eat, starting with a protein source: chicken, eggs, fish or tofu.</p><button type="button" class="button button--primary" data-act="addFood">Add a food</button></section></main>`;
  }
  const list = FOODS.filter((f) => f.name.toLowerCase().includes(q));
  return `<main class="m2">${appBar({ title: 'Food', subline: `YOUR FOODS · ${FOODS.length}` })}${tabs('food')}<div class="m2-seg-wrap">${foodTabs()}</div>${flash()}
    <div class="m2-field-wrap">${field({ label: 'Search your foods', key: 'foodQ', value: S.foodQ, mono: false, placeholder: 'Name or brand' })}</div>
    <div class="section-actions section-actions--tight"><button type="button" class="button button--primary" data-act="addFood">Add a food</button></div>
    <ul class="foods" id="foods-list">${foodRowsList(list, q)}</ul>
    <button type="button" class="link-row" data-act="go" data-id="groups"><span><span class="link-row__name">Rotation groups</span><span class="link-row__meta">${GROUPS.length} groups: foods that stand in for each other</span></span>${chevron()}</button>
    <footer class="footnote footnote--m2"><span>Values per 100 g of the state named</span><span class="footnote__formula">raw or cooked</span></footer></main>`;
}

function foodRowsList(list, q) {
  if (list.length === 0) return `<li class="foods__none">None of your foods match “${esc(q)}”. <button type="button" class="m2-inline-link" data-act="addFood">Add it as a new food</button></li>`;
  return list
    .map((f) => {
      const group = GROUPS.find((g) => g.id === f.group);
      return `<li><button type="button" class="foods__row" data-act="foodOpen" data-id="${f.id}"><span class="foods__text"><span class="foods__name">${esc(f.name)}${f.brand ? `<span class="foods__brand"> · ${esc(f.brand)}</span>` : ''}</span>
        <span class="foods__macros">${f.kcal} kcal · ${f.p} g protein · per 100 g ${f.state}</span>
        <span class="foods__tags">${group ? `<span class="foods__tag">${group.name}</span>` : ''}${f.cooked ? `<span class="foods__tag">Batch-cooked · keeps ${f.keeps} days</span>` : ''}${f.piece ? `<span class="foods__tag">Counted in pieces</span>` : ''}</span></span>${chevron()}</button></li>`;
    })
    .join('');
}

function foodScreen() {
  const f = food(S.foodId);
  const group = GROUPS.find((g) => g.id === f.group);
  const rows = [['Calories', f.kcal, 'kcal'], ['Protein', f.p, 'g'], ['Carbs', f.c, 'g'], ['Fat', f.f, 'g'], ['Fiber', f.fib, 'g']];
  const batches = batchesOf(f.id);
  return `<main class="m2">${appBar({ title: f.name, subline: `${SOURCE_WORD[f.source].toUpperCase()}${f.ref ? ` · ${f.ref}` : ''}`, back: true })}
    <section class="today__section"><h2 class="section-label">Per 100 g, ${f.state}</h2><dl class="values">${rows.map(([l, v, u]) => `<div class="values__row"><dt>${l}</dt><dd>${v}<span class="values__unit"> ${u}</span></dd></div>`).join('')}</dl></section>
    <section class="today__section"><h2 class="section-label">How the plan uses it</h2><dl class="values">
      <div class="values__row"><dt>Counted in</dt><dd class="values__word">${f.piece ? `pieces of ${f.piece} g` : 'grams'}</dd></div>
      <div class="values__row"><dt>Rotation group</dt><dd class="values__word">${group ? group.name : 'None'}</dd></div>
      <div class="values__row"><dt>Batch-cooked</dt><dd class="values__word">${f.cooked ? `Yes, keeps ${f.keeps} days` : 'No'}</dd></div></dl></section>
    ${f.cooked ? `<section class="today__section"><h2 class="section-label">Batches</h2><ul class="batch-list">${batches.length ? batches.map((b, i) => batchRow(b, i === 0)).join('') : '<li class="foods__none">No batch weighed yet. Cooked amounts use MEXT’s cooked values, marked approximate.</li>'}</ul><div class="section-actions section-actions--tight"><button type="button" class="button button--secondary" data-act="batchOpen" data-id="${f.id}">Record a batch</button></div></section>` : ''}
    <div class="section-actions"><button type="button" class="button button--secondary" data-act="noop">Edit</button><button type="button" class="button button--tertiary" data-act="archive">Archive</button></div>
    <p class="m2-hint m2-hint--gutter">Archiving takes it off your list and out of new plans. Past plans keep it.</p></main>`;
}

function batchRow(b, current) {
  const f = food(b.food);
  return `<li class="batch-list__row"><div><span class="batch-list__name">${esc(f.name)}${current ? '<span class="batch-list__current">CURRENT</span>' : ''}</span><span class="batch-list__meta">${weekday(b.on)} ${dayLabel(b.on, false)} · ${n0(b.raw)} g raw → ${n0(b.cooked)} g cooked</span></div><span class="batch-list__yield">${Math.round((b.cooked / b.raw) * 100)}%</span></li>`;
}

function batchesScreen() {
  const cooked = FOODS.filter((f) => f.cooked);
  return `<main class="m2">${appBar({ title: 'Food', subline: 'BATCHES' })}${tabs('food')}<div class="m2-seg-wrap">${foodTabs()}</div>${flash()}
    <p class="m2-lede">A batch is one cook-up, weighed raw and cooked. Its yield turns a cooked portion back into raw macros. The newest batch of a food is the one in use.</p>
    <div class="section-actions section-actions--tight"><button type="button" class="button button--primary" data-act="batchOpen">Record a batch</button></div>
    ${cooked
      .map((f) => {
        const list = batchesOf(f.id);
        const note = yieldNote(f.id);
        return `<section class="today__section"><h2 class="section-label">${esc(f.name)} · keeps ${f.keeps} days</h2>${note.weigh ? `<p class="cook__note cook__note--flag m2-gutterless">${list.length ? 'Last weighed over a week ago. Weigh this week’s batch.' : 'No batch weighed yet. Cooked amounts are approximate.'}</p>` : ''}<ul class="batch-list">${list.map((b, i) => batchRow(b, i === 0)).join('')}</ul></section>`;
      })
      .join('')}</main>`;
}

function batchScreen() {
  const b = S.batch;
  const f = food(b.food);
  const raw = Number(b.raw);
  const cooked = Number(b.cooked);
  const ok = raw > 0 && cooked > 0;
  const y = ok ? cooked / raw : null;
  return `<main class="m2">${appBar({ title: 'Record a batch', subline: b.fromPrep ? 'FROM THE PREP PLAN' : 'WEIGHED AFTER COOKING', back: true })}
    <div class="form">
      <div class="field"><div class="field__label-row"><label class="field__label" for="f-batchFood">Food</label></div><select id="f-batchFood" class="field__input field__select" data-field="batchFood">${FOODS.filter((x) => x.cooked).map((x) => `<option value="${x.id}"${x.id === b.food ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      ${field({ label: 'Cooked on', key: 'batchOn', value: b.on, mono: false, type: 'date' })}
      <div class="form__pair">${field({ label: 'Raw weight', key: 'batchRaw', value: b.raw, unit: 'g', note: b.fromPrep ? 'FROM THE PLAN' : '', placeholder: '0', mode: 'numeric' })}${field({ label: 'Cooked weight', key: 'batchCooked', value: b.cooked, unit: 'g', placeholder: '0', mode: 'numeric', error: b.refused ? 'Both weights must be above 0 g.' : '' })}</div>
      <div class="yield-box" id="yield-box">${yieldBox(y)}</div>
      ${field({ label: 'Keeps for', key: 'batchKeeps', value: b.keeps, unit: 'days', note: 'EVERY BATCH OF THIS FOOD', mode: 'numeric' })}
      <p class="m2-hint">How many days a cooked batch keeps in the fridge. The plan puts it only on days a batch covers, and adds a second cook day when one batch can’t cover the week.</p>
    </div>
    <div class="section-actions"><button type="button" class="button button--primary" data-act="batchSave">Save batch</button></div></main>`;
}

function yieldBox(y) {
  if (y === null) return '<span class="yield-box__label">Yield</span><span class="yield-box__fig">—</span><span class="yield-box__text">Type both weights to see the yield.</span>';
  return `<span class="yield-box__label">Yield</span><span class="yield-box__fig">${Math.round(y * 100)}%</span><span class="yield-box__text">100 g cooked counts as ${n0(100 / y)} g raw. Plans made from now on use it; past ones keep theirs.${y > 1 ? ' It gained water, which is right for rice.' : ''}</span>`;
}

function groupsScreen() {
  return `<main class="m2">${appBar({ title: 'Rotation groups', back: true })}
    <p class="m2-lede">Foods that stand in for each other. The planner picks within a group to vary the week, and Adjust offers the others as swaps.</p>
    ${GROUPS.map((g) => {
      const members = FOODS.filter((f) => f.group === g.id);
      return `<section class="today__section"><h2 class="section-label">${g.name} · ${members.length}</h2><ul class="group">${members.map((f) => `<li class="group__row"><span>${esc(f.name)}</span><button type="button" class="button button--tertiary group__remove" data-act="noop">Remove</button></li>`).join('')}
        <li><button type="button" class="group__add" data-act="noop">+ Add a food to ${g.name.toLowerCase()}</button></li></ul></section>`;
    }).join('')}
    <div class="section-actions"><button type="button" class="button button--secondary" data-act="noop">New group</button></div></main>`;
}

// ---------------------------------------------------------------- adding a food (S12, F9)

function addScreen() {
  const q = S.addQ.trim().toLowerCase();
  const hits = q.length < 2 ? [] : MEXT.filter((m) => m.en.toLowerCase().includes(q) || m.jp.includes(q));
  const results =
    q.length < 2
      ? ''
      : hits.length === 0
        ? `<p class="foods__none">Nothing in the MEXT table for “${esc(S.addQ)}”. A packaged food is quicker by its barcode.</p>`
        : `<ul class="pick">${hits.map((m) => `<li><button type="button" class="pick__row" data-act="mextPick" data-id="${m.code}"><span class="pick__name">${esc(m.en)}</span><span class="pick__jp">${m.jp}</span><span class="pick__meta">${m.kcal} kcal · ${m.p} g protein per 100 g · MEXT ${m.code}</span></button></li>`).join('')}</ul>`;
  return `<main class="m2">${appBar({ title: 'Add a food', back: true })}
    <div class="m2-field-wrap">${field({ label: 'Search the MEXT food table', key: 'addQ', value: S.addQ, mono: false, placeholder: 'Chicken breast, 鶏むね…' })}</div>
    <div id="add-results">${results}</div>
    <section class="today__section"><h2 class="section-label">Not in the table?</h2><ul class="ways">
      <li><button type="button" class="ways__row" data-act="go" data-id="barcode"><span class="ways__name">Scan a barcode</span><span class="ways__meta">For packaged food. Looked up in Open Food Facts.</span>${chevron()}</button></li>
      <li><button type="button" class="ways__row" data-act="labelOpen"><span class="ways__name">Photograph the label</span><span class="ways__meta">The 栄養成分表示, read for you. You check it before it is saved.</span>${chevron()}</button></li>
      <li><button type="button" class="ways__row" data-act="manualOpen"><span class="ways__name">Enter it by hand</span><span class="ways__meta">Copy the numbers from the packet yourself.</span>${chevron()}</button></li></ul></section></main>`;
}

const viewfinder = (caption, shape = 'bar') => `<div class="viewfinder viewfinder--${shape}" aria-hidden="true"><span class="viewfinder__frame"></span><span class="viewfinder__caption">${caption}</span></div>`;

function barcodeScreen() {
  const outcomes = [['found', 'Found'], ['missing', 'Not found'], ['existing', 'Already on list'], ['down', 'Service down']];
  let result = '';
  if (S.scanned) {
    if (S.scan === 'missing')
      result = `<section class="empty-state"><h2 class="empty-state__title">Not in Open Food Facts</h2><p class="empty-state__body">Barcode 4 902102 141109 isn’t in the database. The label has the numbers.</p><button type="button" class="button button--primary" data-act="labelOpen">Photograph the label</button><button type="button" class="button button--tertiary" data-act="manualOpen">Enter it by hand</button></section>`;
    if (S.scan === 'existing')
      result = `<section class="empty-state"><h2 class="empty-state__title">Already on your list</h2><p class="empty-state__body">Rolled oats has this barcode. Nothing new was made.</p><button type="button" class="button button--primary" data-act="foodOpen" data-id="oats">Open Rolled oats</button></section>`;
    if (S.scan === 'down')
      result = `<div class="notice notice--flag m2-notice">${info()}<div><span class="notice__word" style="color:var(--flag)">Open Food Facts isn’t answering</span><p>Try again in a minute, or carry on without it.</p></div></div><div class="section-actions"><button type="button" class="button button--primary" data-act="labelOpen">Photograph the label</button><button type="button" class="button button--tertiary" data-act="manualOpen">Enter it by hand</button></div>`;
  }
  return `<main class="m2">${appBar({ title: 'Scan a barcode', back: true })}
    ${viewfinder('Hold the barcode inside the frame')}
    ${result || `<div class="section-actions"><button type="button" class="button button--primary" data-act="scan">Simulate a scan</button></div>`}
    <div class="proto-choice"><span class="proto-choice__label">Prototype only: what the scan finds</span>${segments(outcomes, S.scan, 'scanOutcome', 'm2-seg--proto')}</div></main>`;
}

function labelScreen() {
  const outcomes = [['read', 'Read'], ['unreadable', 'Unreadable'], ['cap', 'Cap reached'], ['down', 'Service down']];
  let body;
  if (S.labelStep === 'aim')
    body = `${viewfinder('Fill the frame with the 栄養成分表示', 'label')}<p class="m2-hint m2-hint--gutter">Flat, in good light, every line in view. The photo is read once and not kept.</p><div class="section-actions"><button type="button" class="button button--primary" data-act="labelShoot">Take the photo</button></div>`;
  else if (S.labelStep === 'reading') body = `${viewfinder('Reading the label…', 'label')}<p class="m2-generating" role="status">Reading the label. This takes a few seconds.</p>`;
  else if (S.label === 'unreadable')
    body = `<section class="empty-state"><h2 class="empty-state__title">Couldn’t read the label</h2><p class="empty-state__body">The photo was blurred or cut off. Try again closer and flatter, or type the numbers.</p><button type="button" class="button button--primary" data-act="labelRetake">Retake</button><button type="button" class="button button--tertiary" data-act="manualOpen">Enter it by hand</button></section>`;
  else if (S.label === 'cap')
    body = `<div class="notice notice--flag m2-notice">${info()}<div><span class="notice__word" style="color:var(--flag)">Photo reads used up for today</span><p>Label reading has a daily limit. Typing the numbers works now, and reading comes back tomorrow.</p></div></div><div class="section-actions"><button type="button" class="button button--primary" data-act="manualOpen">Enter it by hand</button></div>`;
  else
    body = `<div class="notice notice--flag m2-notice">${info()}<div><span class="notice__word" style="color:var(--flag)">The reader isn’t answering</span><p>What was read before it stopped is filled in. Check it and type the rest.</p></div></div><div class="section-actions"><button type="button" class="button button--primary" data-act="labelPartial">Continue by hand</button></div>`;
  return `<main class="m2">${appBar({ title: 'Photograph the label', back: true })}${body}
    <div class="proto-choice"><span class="proto-choice__label">Prototype only: what the read returns</span>${segments(outcomes, S.label, 'labelOutcome', 'm2-seg--proto')}</div></main>`;
}

const BASIS = [['100g', 'Per 100 g'], ['piece', 'Per piece'], ['serving', 'Per serving'], ['package', 'Per package']];

function confirmScreen() {
  const c = S.candidate;
  const factor = c.basisGrams ? 100 / c.basisGrams : 1;
  const per100 = (v) => (v === null || v === '' ? '' : String(Math.round(Number(v) * factor * 10) / 10));
  const printed =
    c.basis !== '100g' && c.printed
      ? `<section class="printed"><div class="printed__head"><span class="section-label">As printed</span><span class="printed__basis">${BASIS.find((b) => b[0] === c.basis)[1]} (${c.basisGrams} g)</span></div>
        <dl class="printed__grid">${[['kcal', 'Energy', 'kcal'], ['p', 'Protein', 'g'], ['c', 'Carbs', 'g'], ['f', 'Fat', 'g'], ['fib', 'Fiber', 'g']].map(([k, l, u]) => `<div><dt>${l}</dt><dd>${c.printed[k] === null ? `<span class="printed__none">${c.partial && k !== 'fib' ? 'not read' : 'not printed'}</span>` : `${c.printed[k]}<span class="values__unit"> ${u}</span>`}</dd></div>`).join('')}</dl></section>`
      : '';
  const v = c.printed ?? {};
  // A value the source did not give stays empty and says why: never guessed (F9 step 5).
  const valueField = (label, key, k, unit) => {
    const missing = !c.manual && v[k] === null;
    const note = missing ? (c.partial && k !== 'fib' ? 'NOT READ' : 'NOT ON THE LABEL: LEFT EMPTY') : '';
    return field({ label, key, value: c.manual || missing ? '' : per100(v[k]), unit, placeholder: missing ? '—' : '0', note });
  };
  return `<main class="m2">${appBar({ title: 'Check before saving', subline: c.sourceLine, back: true })}
    ${c.duplicate ? `<div class="notice notice--flag m2-notice">${info()}<div><span class="notice__word" style="color:var(--flag)">Already on your list</span><p>${esc(c.name)} is saved already. <button type="button" class="m2-inline-link" data-act="foodOpen" data-id="${c.duplicate}">Open it</button></p></div></div>` : ''}
    ${c.partial ? `<div class="notice notice--flag m2-notice">${info()}<span>Only part of the label was read before the reader stopped. The empty fields are yours to fill.</span></div>` : ''}
    <p class="m2-lede">${c.manual ? 'Type what the packet says. It is saved per 100 g.' : 'Nothing is saved until you press Save. Fix anything that was read wrong.'}</p>
    ${printed}
    <div class="form">
      ${field({ label: 'Name', key: 'cName', value: c.name, mono: false, placeholder: 'What you call it' })}
      ${field({ label: 'Brand', key: 'cBrand', value: c.brand ?? '', mono: false, placeholder: 'Optional', note: 'OPTIONAL' })}
      ${c.manual ? `<div class="field"><span class="field__label">The packet gives values</span>${segments(BASIS, c.basis, 'basis', 'm2-seg--basis')}</div>${c.basis === '100g' ? '' : field({ label: 'That amount weighs', key: 'cBasisG', value: c.basisGrams ?? '', unit: 'g', placeholder: '0' })}` : ''}
      <div class="m2-subhead"><span class="section-label">Per 100 g, as it will be saved</span>${c.basis !== '100g' && !c.manual ? '<span class="m2-subhead__note">converted from the label</span>' : ''}</div>
      <div class="form__pair">${valueField('Calories', 'cK', 'kcal', 'kcal')}${valueField('Protein', 'cP', 'p', 'g')}</div>
      <div class="form__pair">${valueField('Carbs', 'cC', 'c', 'g')}${valueField('Fat', 'cF', 'f', 'g')}</div>
      ${valueField('Fiber', 'cFib', 'fib', 'g')}
      <div class="field"><span class="field__label">This food is</span>${segments([['raw', 'Raw'], ['cooked', 'Cooked']], c.state, 'cState', 'm2-seg--basis')}</div>
      ${field({ label: 'One piece weighs', key: 'cPiece', value: c.piece ?? '', unit: 'g', placeholder: '—', note: 'EMPTY: COUNTED IN GRAMS' })}
      ${field({ label: 'A cooked batch keeps for', key: 'cKeeps', value: c.keeps ?? '', unit: 'days', placeholder: '—', note: 'EMPTY: NOT BATCH-COOKED' })}
      <div class="field"><div class="field__label-row"><label class="field__label" for="f-cGroup">Rotation group</label><span class="field__note">OPTIONAL</span></div><select id="f-cGroup" class="field__input field__select" data-field="cGroup"><option value="">None</option>${GROUPS.map((g) => `<option value="${g.id}"${c.group === g.id ? ' selected' : ''}>${g.name}</option>`).join('')}</select></div>
    </div>
    <div class="section-actions"><button type="button" class="button button--primary" data-act="saveFood">Save to my foods</button><button type="button" class="button button--tertiary" data-act="back">Discard</button></div></main>`;
}

// ---------------------------------------------------------------- goal phase and targets (S14), your day (S15)

function sourceLine(text, sheetId) {
  return `<p class="m2-source-line">${text}${sheetId ? ` ${evidenceTag(SHEETS[sheetId].tag, sheetId, SHEETS[sheetId].strength)}` : ''}</p>`;
}

function profileScreen() {
  return `<main class="m2">${appBar({ title: 'About you', subline: 'STEP 1 OF 4', back: true })}
    <p class="m2-lede">Used only to work out starting calories and protein. You can change any of it later.</p>
    <div class="form">${field({ label: 'Weight', key: 'pW', value: '82.4', unit: 'kg', note: 'FROM YOUR WEIGH-IN TODAY' })}
      <div class="form__pair">${field({ label: 'Height', key: 'pH', value: '176', unit: 'cm' })}${field({ label: 'Birth date', key: 'pB', value: '1995-03-08', mono: false, type: 'date' })}</div>
      <div class="field"><span class="field__label">Sex, for the formula only</span>${segments([['male', 'Male'], ['female', 'Female']], 'male', 'noop', 'm2-seg--basis')}</div></div>
    <div class="section-actions"><button type="button" class="button button--primary" data-act="setupDone" data-id="profile">Save</button></div></main>`;
}

function phaseScreen() {
  const p = S.phaseForm;
  const kg = PROFILE.weightKg;
  const rate = Number(p.rate) || 0;
  const protein = Math.round((Number(p.protein) || 0) * kg);
  const kcal = Number(p.kcal) || 0;
  const fat = Math.round((kcal * (Number(p.fat) || 0)) / 100 / 9);
  const carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  const change = p.type !== PHASE.type && S.setup.phase;
  return `<main class="m2">${appBar({ title: 'Goal phase', subline: S.setup.phase ? `CUT SINCE ${dayLabel(PHASE.started, false).toUpperCase()} · WEEK 7` : 'STEP 3 OF 4', back: true })}
    <div class="m2-seg-wrap m2-seg-wrap--top">${segments([['cut', 'Cut'], ['maintain', 'Maintain'], ['bulk', 'Bulk']], p.type, 'phaseType')}</div>
    ${change ? `<div class="notice notice--flag m2-notice">${info()}<div><span class="notice__word" style="color:var(--flag)">A cut is open</span><p>Saving ends the cut on ${dayLabel(TODAY, false)} and starts a ${p.type} from today. The cut is kept, with what it did.</p></div></div>` : ''}
    <div class="form">
      ${p.type === 'maintain' ? '' : `${field({ label: `Target rate, ${p.type === 'cut' ? 'loss' : 'gain'} a week`, key: 'rate', value: p.rate, unit: '% bodyweight', note: rate === 0.5 ? 'DEFAULT' : 'YOURS' })}
      <p class="m2-derived">That is about <b>${n1((rate / 100) * kg)} kg a week</b> at ${kg} kg.</p>${p.type === 'cut' ? sourceLine('Default 0.5%, the slow end of 0.5–1% a week.', 'rate') : ''}`}
      ${field({ label: 'Protein', key: 'protein', value: p.protein, unit: 'g per kg', note: Number(p.protein) === 2.2 ? 'DEFAULT' : 'YOURS' })}
      <p class="m2-derived"><b>${protein} g a day</b> at ${kg} kg.${p.type === 'cut' ? ' A cut starts at the top of the range, because needs rise in a deficit. You can go higher.' : ''}</p>${sourceLine('Range 1.6–2.2 g per kg.', 'proteinkg')}
      ${field({ label: 'Fat', key: 'fat', value: p.fat, unit: '% of calories', note: Number(p.fat) === 27 ? 'DEFAULT' : 'YOURS' })}
      <p class="m2-derived"><b>${fat} g a day.</b> Carbohydrate is what remains: <b>${carbs} g</b>.</p>
      ${field({ label: 'Calories', key: 'kcal', value: p.kcal, unit: 'kcal a day', note: Number(p.kcal) === PHASE.kcal ? 'PROVISIONAL' : 'YOURS' })}
      <div class="provisional"><span class="provisional__word">Provisional</span><p>A formula’s estimate from your height, weight, age and sex, less ${p.type === 'cut' ? 'the deficit for your rate' : p.type === 'bulk' ? 'plus the surplus for your rate' : 'nothing'}. It is replaced when you apply the maintenance check, after 14 complete days.</p><span class="provisional__src">Formula chosen in slice 4, and cited here</span></div>
    </div>
    <div class="section-actions"><button type="button" class="button button--primary" data-act="phaseSave">${change ? `End the cut and start a ${p.type}` : 'Save targets'}</button></div></main>`;
}

function routineScreen() {
  const r = S.routineForm[S.routineDay];
  const days = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const training = S.routineDay === 'training';
  const meals = r.meals;
  const times = recommendTimes(r, meals);
  const perMeal = TARGETS.p / meals;
  return `<main class="m2">${appBar({ title: 'Your day', subline: S.setup.routine ? 'MEAL TIMES AND COUNT' : 'STEP 4 OF 4', back: true })}
    <div class="m2-seg-wrap m2-seg-wrap--top">${segments([['training', 'Training day'], ['rest', 'Rest day']], S.routineDay, 'routineDay')}</div>
    <div class="form">
      <div class="field"><span class="field__label">Training days</span><div class="weekdays" role="group">${days.map((d, i) => `<button type="button" class="weekdays__day" data-act="weekday" data-id="${i + 1}" aria-pressed="${S.routineForm.weekdays.includes(i + 1)}">${d}</button>`).join('')}</div></div>
      <div class="form__pair">${field({ label: 'Wake', key: 'rWake', value: r.wake, mono: false, type: 'time' })}${field({ label: 'Bed', key: 'rBed', value: r.bed, mono: false, type: 'time' })}</div>
      <div class="form__pair">${field({ label: 'Work starts', key: 'rWs', value: r.workStart, mono: false, type: 'time' })}${field({ label: 'Work ends', key: 'rWe', value: r.workEnd, mono: false, type: 'time' })}</div>
      ${training ? field({ label: 'Training time', key: 'rTrain', value: r.train, mono: false, type: 'time' }) : ''}
    </div>
    <section class="recommend"><div class="recommend__head"><span class="recommend__label">Recommended</span><div class="stepper stepper--small"><button type="button" class="stepper__btn" data-act="mealCount" data-d="-1" aria-label="One meal fewer">−</button><span class="stepper__value">${meals}<span class="stepper__unit"> meals</span></span><button type="button" class="stepper__btn" data-act="mealCount" data-d="1" aria-label="One meal more">+</button></div></div>
      <ol class="recommend__times">${times.map(([t, l]) => `<li><span class="recommend__time">${t}</span><span>${l}</span></li>`).join('')}</ol>
      <p class="recommend__why">${TARGETS.p} g of protein over ${meals} meals is about ${Math.round(perMeal)} g each, ${(perMeal / PROFILE.weightKg).toFixed(2)} g per kg${perMeal / PROFILE.weightKg >= 0.4 && perMeal / PROFILE.weightKg <= 0.55 ? ', inside 0.4–0.55' : perMeal / PROFILE.weightKg > 0.55 ? ', above 0.55: one more meal would spread it better' : ', under 0.4: one fewer meal would make each count'}.${training ? ' One meal sits about 2 hours before training and one soon after.' : ''}</p>
      ${sourceLine('', 'protein')}
      <p class="recommend__note">How many meals you eat does not change fat loss at equal calories. The count is for spreading protein, so pick what fits your day.</p>
      ${meals !== (training ? ROUTINE.training.meals : ROUTINE.rest.meals) ? `<p class="recommend__yours">Yours: ${meals} meals. The recommendation was ${training ? ROUTINE.training.meals : ROUTINE.rest.meals}.</p>` : ''}</section>
    <div class="section-actions"><button type="button" class="button button--primary" data-act="routineSave">Use these meals</button></div></main>`;
}

function recommendTimes(r, meals) {
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60 / 5) * 5 % 60).padStart(2, '0')}`;
  const start = toMin(r.wake) + 30;
  const end = toMin(r.bed) - 90;
  if (r.train) {
    const tr = toMin(r.train);
    const fixed = [[tr - 120, 'Before training'], [tr + 75, 'After training']];
    const before = Math.max(0, meals - 2 - (meals >= 5 ? 1 : 0));
    const out = [];
    for (let i = 0; i < before; i += 1) out.push([start + ((tr - 120 - start) / before) * i, ['Breakfast', 'Lunch', 'Afternoon', 'Snack'][i] ?? 'Meal']);
    return [...out, ...fixed, ...(meals >= 5 ? [[end, 'Evening']] : [])].sort((a, b) => a[0] - b[0]).map(([m, l]) => [fromMin(m), l]);
  }
  const labels = ['Breakfast', 'Lunch', 'Afternoon', 'Dinner', 'Evening', 'Late'];
  return Array.from({ length: meals }, (_, i) => [fromMin(start + ((end - start) / Math.max(1, meals - 1)) * i), meals === 3 ? ['Breakfast', 'Lunch', 'Dinner'][i] : labels[i]]);
}

// ---------------------------------------------------------------- Progress: weight (screen 6)

const progressTabs = (current) => segments([['history', 'History'], ['strength', 'Strength'], ['balance', 'Balance'], ['weight', 'Weight']], current, 'progTab', 'm2-seg--sub');

function weightChart(series, span) {
  const W = 358;
  const H = 186;
  const from = span === '30' ? addDays(TODAY, -29) : PHASE.started;
  const pts = series.filter((w) => w.date >= from);
  if (pts.length === 0) return '';
  const days = daysBetween(from, TODAY);
  const kgs = pts.flatMap((w) => [w.kg, w.trend]);
  const lo = Math.floor(Math.min(...kgs) - 0.3);
  const hi = Math.ceil(Math.max(...kgs) + 0.3);
  const x = (iso) => 30 + (daysBetween(from, iso) / days) * (W - 38);
  const y = (kg) => 10 + ((hi - kg) / (hi - lo)) * (H - 34);
  const grid = [];
  for (let v = lo; v <= hi; v += 1) grid.push(`<line class="chart__gridline" x1="30" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="chart__label" x="0" y="${y(v) + 3}">${v}</text>`);
  const trendOk = series.length >= 3;
  const line = trendOk ? `<path class="chart__line wchart__trend" d="${pts.map((w, i) => `${i ? 'L' : 'M'}${x(w.date).toFixed(1)} ${y(w.trend).toFixed(1)}`).join(' ')}"/>` : '';
  const dots = pts.map((w) => (w.morning ? `<circle class="wchart__dot" cx="${x(w.date).toFixed(1)}" cy="${y(w.kg).toFixed(1)}" r="2.5"/>` : `<circle class="wchart__ring" cx="${x(w.date).toFixed(1)}" cy="${y(w.kg).toFixed(1)}" r="2.2"/>`)).join('');
  const last = pts.at(-1);
  const latest = trendOk ? `<circle class="chart__latest" cx="${x(last.date)}" cy="${y(last.trend)}" r="3.5"/>` : '';
  const ticks = [from, addDays(from, Math.round(days / 2)), TODAY].map((d, i) => `<text class="chart__label" x="${i === 0 ? 30 : i === 1 ? x(d) - 14 : W - 32}" y="${H - 6}">${dayLabel(d, false)}</text>`).join('');
  return `<svg class="wchart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Daily weights and the trend">${grid.join('')}${line}${dots}${latest}${ticks}</svg>`;
}

function maintCard() {
  const m = maintenance();
  if (S.maint === 'collecting') {
    return `<section class="card card--active maint"><div class="maint__head"><span class="maint__title">Maintenance check</span><span class="maint__ref">9 OF 14 COMPLETE DAYS</span></div>
      <div class="maint__count"><span class="maint__count-fig">5</span><span class="maint__count-words">complete days to go</span></div>
      <p class="maint__caveat">A complete day is one where every planned meal was confirmed. After 14 of them, this card compares what you ate with how your weight moved.</p></section>`;
  }
  if (S.maint === 'weighin') {
    return `<section class="card card--active maint"><div class="maint__head"><span class="maint__title">Maintenance check</span><span class="maint__ref">LAST 14 DAYS · 12 COMPLETE</span></div>
      <div class="maint__count"><span class="maint__count-words maint__count-words--big">Weigh in to see this</span></div>
      <p class="maint__caveat">It needs 3 weigh-ins in the last 14 days, one of them in the last 7. You have 2, the newest on 6 Oct. Complete days keep counting meanwhile.</p>
      <button type="button" class="button button--secondary" data-act="weighOpen">Type a weight</button></section>`;
  }
  const low = S.maint === 'low';
  return `<section class="card card--active maint"><div class="maint__head"><span class="maint__title">Maintenance check</span><span class="maint__ref">LAST 14 DAYS · ${low ? 9 : m.inWindow} COMPLETE</span></div>
    <div class="maint__figs"><div><span class="maint__label">You ate, on average</span><span class="maint__fig">${n0(m.intake)}<span class="maint__unit"> kcal a day</span></span></div><div><span class="maint__label">Your trend moved</span><span class="maint__fig">${signed(m.perWeek, 2)}<span class="maint__unit"> kg a week</span></span></div></div>
    <div class="maint__result"><span class="maint__result-words">So your maintenance is about</span><span class="maint__result-fig">≈ ${n0(Math.round(m.kcal / 10) * 10)}<span class="maint__unit"> kcal</span></span></div>
    ${low ? `<p class="maint__low">${info(14)}Based on too little recent logging: ${3} of the last 7 days are complete.</p>` : ''}
    ${S.applied ? `<p class="maint__caveat">Applied today: your calories are ${n0(S.applied)} kcal, measured. The next check can be applied in a week.</p>` : `<p class="maint__caveat">Read-only. Your targets stay at ${n0(TARGETS.kcal)} kcal until you apply this.</p>
    <button type="button" class="button button--primary maint__apply" data-act="applyAsk">Apply to targets</button>`}</section>`;
}

function applySheet() {
  const m = maintenance();
  const maint = Math.round(m.kcal / 10) * 10;
  const deficit = Math.round(((PHASE.ratePct / 100) * PROFILE.weightKg * 7700) / 7 / 10) * 10;
  return `<div class="sheet-scrim" data-act="sheetClose"><div class="sheet" role="dialog" aria-label="Apply to targets" data-act="noop">
    <div class="sheet__head"><h2 class="section-label">Apply to targets</h2><button type="button" class="sheet__close" data-act="sheetClose">CLOSE</button></div>
    <p class="sheet__claim">Set your calories to ${n0(maint - deficit)} kcal a day?</p>
    <p class="sheet__means">Your maintenance of about ${n0(maint)} kcal, less ${n0(deficit)} kcal for your cut of ${PHASE.ratePct}% a week. Protein stays at ${TARGETS.p} g. Today’s unconfirmed meals and the rest of the week are planned again; confirmed meals stay as they are.</p>
    <div class="apply__compare"><span>Now <b>${n0(TARGETS.kcal)}</b> provisional</span><span>→</span><span>New <b>${n0(maint - deficit)}</b> measured</span></div>
    <button type="button" class="button button--primary" data-act="applyDo">Apply ${n0(maint - deficit)} kcal</button><button type="button" class="button button--tertiary" data-act="sheetClose">Not now</button></div></div>`;
}

function weightScreen() {
  const list = weighIns();
  const series = trendSeries(list);
  if (list.length === 0) {
    return `<main class="m2">${appBar({ title: 'Progress', subline: 'WEIGHT' })}${tabs('progress')}<div class="m2-seg-wrap">${progressTabs('weight')}</div>
      <section class="empty-state"><h2 class="empty-state__title">No weigh-ins yet</h2><p class="empty-state__body">Your morning weight can arrive from the scale by itself, or you can type it. The trend line starts from your third day.</p><button type="button" class="button button--primary" data-act="weighOpen">Type a weight</button><button type="button" class="button button--secondary" data-act="go" data-id="route">Set up the scale</button></section></main>`;
  }
  const trendOk = series.length >= 3;
  const last = series.at(-1);
  const wkAgo = trendAt(series, addDays(TODAY, -7));
  const rate = last.trend - wkAgo;
  const lateInView = series.some((w) => !w.morning && w.date >= addDays(TODAY, -29));
  const recent = [...series].reverse().slice(0, 6);
  return `<main class="m2">${appBar({ title: 'Progress', subline: 'WEIGHT' })}${tabs('progress')}<div class="m2-seg-wrap">${progressTabs('weight')}</div>${flash()}
    <section class="whead">${trendOk
      ? `<div><span class="whead__label">Trend</span><span class="whead__fig">${n1(last.trend)}<span class="whead__unit"> kg</span></span></div><div class="whead__rate"><span class="whead__rate-fig">${signed(rate, 2)} kg</span><span class="whead__rate-words">in the last week</span></div>`
      : `<div><span class="whead__label">Latest weigh-in</span><span class="whead__fig">${n1(last.kg)}<span class="whead__unit"> kg</span></span></div><div class="whead__rate"><span class="whead__rate-words">The trend starts from your third day of weigh-ins. ${3 - series.length} to go.</span></div>`}</section>
    ${trendOk ? `<div class="m2-seg-wrap">${segments([['30', '30 days'], ['phase', 'Since 4 Sep']], S.weightSpan, 'weightSpan', 'segments--mono')}</div>` : ''}
    <div class="chart wchart-wrap">${weightChart(series, S.weightSpan)}</div>
    <div class="legend">${trendOk ? '<span class="legend__item"><span class="legend__swatch wlegend__trend"></span>Trend</span>' : ''}<span class="legend__item"><span class="wlegend__dot"></span>Morning weigh-in</span>${lateInView ? '<span class="legend__item"><span class="wlegend__ring"></span>Not a morning weigh-in</span>' : ''}</div>
    <div class="section-actions section-actions--row"><button type="button" class="button button--secondary" data-act="weighOpen">Type a weight</button><button type="button" class="button button--tertiary" data-act="go" data-id="route">Scale: ${S.routeState === 'synced' ? 'arrived 07:01' : 'set up'}</button></div>
    <div class="today__section">${maintCard()}</div>
    <section class="today__section"><h2 class="section-label">Recent weigh-ins</h2><ul class="weighins">${recent
      .map((w) => `<li class="weighins__row"><span class="weighins__date">${dayLabel(w.date)}</span><span class="weighins__time">${w.time}${w.morning ? '' : ' · not morning'}</span><span class="weighins__kg">${n1(w.kg)}<span class="weighins__unit"> kg</span></span><span class="weighins__src">${w.source === 'manual' ? `<button type="button" class="button button--tertiary weighins__del" data-act="noop">Delete</button>` : 'Scale'}</span></li>`)
      .join('')}</ul></section>
    <button type="button" class="link-row" data-act="phaseOpen"><span><span class="link-row__name">Cut since ${dayLabel(PHASE.started, false)} · week 7</span><span class="link-row__meta">Target: lose ${PHASE.ratePct}% a week, about ${n1((PHASE.ratePct / 100) * PROFILE.weightKg)} kg</span></span>${chevron()}</button>
    <footer class="footnote footnote--m2"><span>The trend smooths each day’s weight</span><span class="footnote__formula">10% a day</span></footer></main>`;
}

function weighScreen() {
  const w = S.weigh;
  const t = w.time;
  const morning = t < '10:00';
  return `<main class="m2">${appBar({ title: 'Type a weight', back: true })}
    <div class="form">${field({ label: 'Weight', key: 'wKg', value: w.kg, unit: 'kg', placeholder: '0.0', error: w.refused ? 'A weight between 20 and 300 kg.' : '' })}
      <div class="form__pair">${field({ label: 'Date', key: 'wDate', value: w.date, mono: false, type: 'date' })}${field({ label: 'Time', key: 'wTime', value: w.time, mono: false, type: 'time' })}</div>
      <p class="m2-hint" id="weigh-hint">${morning ? 'Before 10:00, so it counts as this morning’s weigh-in, unless the scale sent an earlier one.' : 'After 10:00. It counts for the day only if there is no reading before 10:00, and is marked as not a morning weigh-in.'}</p>
      ${field({ label: 'Body fat', key: 'wFat', value: '', unit: '%', placeholder: '—', note: 'OPTIONAL' })}</div>
    <div class="section-actions"><button type="button" class="button button--primary" data-act="weighSave">Save weigh-in</button></div>
    <p class="m2-hint m2-hint--gutter">Typing is always here, next to the scale. A typed weigh-in can be deleted; one from the scale cannot, because the scale would send it again.</p></main>`;
}

function routeScreen() {
  const synced = S.routeState === 'synced';
  const status = `<section class="route__status${synced ? ' route__status--ok' : ''}"><span class="route__status-label">Weight from the scale</span><span class="route__status-fig">${synced ? 'Arrived today 07:01' : 'Never arrived'}</span><span class="route__status-meta">${synced ? 'Eufy P2 Pro · 82.4 kg · this morning' : 'Finish the steps below, then weigh in.'}</span></section>`;
  const google = `<ol class="route__steps">
      <li class="route__step"><span class="route__n">1</span><div><span class="route__title">Link Fitbit in EufyLife</span><span class="route__text">EufyLife › Me › Integrations › Fitbit. The scale then sends each reading on by itself, without the phone.</span></div></li>
      <li class="route__step"><span class="route__n">2</span><div><span class="route__title">Allow Overload to read your weight</span><span class="route__text">Google asks once. Overload reads weight and body fat only.</span>${synced ? `<span class="route__done">${check(13, 'var(--done)')}Connected as yuta…@gmail.com</span>` : '<button type="button" class="button button--secondary" data-act="routeConnect">Connect Google</button>'}</div></li>
      <li class="route__step"><span class="route__n">3</span><div><span class="route__title">Weigh in</span><span class="route__text">It should arrive here within a few minutes.</span></div></li></ol>`;
  const hae = `<ol class="route__steps">
      <li class="route__step"><span class="route__n">1</span><div><span class="route__title">Health Auto Export, Premium</span><span class="route__text">From the App Store. Its REST export needs Premium.</span></div></li>
      <li class="route__step"><span class="route__n">2</span><div><span class="route__title">Make a token for it</span><span class="route__text">Shown once. Paste it into the app, then it is hidden here for good.</span>
        ${S.token ? `<code class="route__token">ovl_7Kx2…<b>shown once</b></code><button type="button" class="button button--tertiary" data-act="noop">Copy</button>` : '<button type="button" class="button button--secondary" data-act="routeToken">Make a token</button>'}</div></li>
      <li class="route__step"><span class="route__n">3</span><div><span class="route__title">Add the automation</span><span class="route__text">Automations › New › REST API. Name <code>overload-weight</code>, metric Weight, the address below, header <code>Authorization: Bearer</code> and the token.</span><code class="route__url">https://overload.app/api/ingest/health-auto-export</code></div></li>
      <li class="route__step"><span class="route__n">4</span><div><span class="route__title">Weigh in, then unlock the phone</span><span class="route__text">iOS sends Health data only while the phone is unlocked, so a morning reading arrives at your next unlock.</span></div></li></ol>
      ${S.token ? '<div class="section-actions"><button type="button" class="button button--tertiary" data-act="noop">Revoke the token</button></div>' : ''}`;
  return `<main class="m2">${appBar({ title: 'Weight from the scale', back: true })}${status}
    <div class="m2-seg-wrap">${segments([['google', 'Google Health'], ['hae', 'Health Auto Export']], S.route, 'route')}</div>
    <p class="m2-hint m2-hint--gutter">Prototype: both routes drawn. The app shows the one the two hardware tests pick (06, 19 Sep).</p>
    ${S.route === 'google' ? google : hae}
    <div class="proto-choice"><span class="proto-choice__label">Prototype only: sync state</span>${segments([['never', 'Never arrived'], ['synced', 'Arrived']], S.routeState, 'routeState', 'm2-seg--proto')}</div></main>`;
}

function progressOther() {
  const what = { history: 'History', strength: 'Strength', balance: 'Balance' }[S.progTab];
  return `<main class="m2">${appBar({ title: 'Progress', subline: what.toUpperCase() })}${tabs('progress')}<div class="m2-seg-wrap">${progressTabs(S.progTab)}</div>
    ${protoNote(`${what} is unchanged from M1 (docs/10 §9). Only the fourth section, Weight, is new. Open Weight to see it.`)}</main>`;
}

// ---------------------------------------------------------------- Routines and Exercises, unchanged from M1

function trainingList(which) {
  if (which === 'routines')
    return `<ul class="routines routines--flush">${ROUTINES.map((r) => `<li><button type="button" class="routines__row" data-act="noop"><span class="routines__text"><span class="routines__name">${r.name}</span><span class="routines__meta">${r.exercises} EXERCISES · ${r.sets} SETS</span></span>${chevron()}</button></li>`).join('')}</ul>`;
  return `<ul class="routines routines--flush">${['Barbell Bench Press', 'Seated Dumbbell Shoulder Press', 'Cable Lateral Raise', 'Barbell Row', 'Lat Pulldown', 'Barbell Back Squat'].map((n) => `<li><button type="button" class="routines__row" data-act="noop"><span class="routines__text"><span class="routines__name">${n}</span></span>${chevron()}</button></li>`).join('')}</ul>`;
}

function routinesScreen() {
  return `<main class="m2">${appBar({ title: 'Routines' })}${tabs('routines')}${protoNote('Unchanged from M1 (docs/10 §8.1).')}${trainingList('routines')}</main>`;
}
function exercisesScreen() {
  return `<main class="m2">${appBar({ title: 'Exercises' })}${tabs('exercises')}${protoNote('Unchanged from M1 (docs/10 §8.1).')}${trainingList('exercises')}</main>`;
}
function workoutStub() {
  return `<main class="m2">${appBar({ title: 'Push A', subline: '0:04 ELAPSED', back: true })}${protoNote('The workout screen is M1’s, unchanged (docs/prototype/ and docs/10 §1). Back returns to Today, where the workout’s place in the day shows it in progress.')}</main>`;
}

// ---------------------------------------------------------------- render and navigation

const SCREENS = {
  today: todayScreen,
  adjust: adjustScreen,
  replace: replaceScreen,
  eod: eodScreen,
  prep: prepScreen,
  grocery: groceryScreen,
  foods: foodsScreen,
  batches: batchesScreen,
  food: foodScreen,
  batch: batchScreen,
  groups: groupsScreen,
  add: addScreen,
  barcode: barcodeScreen,
  label: labelScreen,
  confirm: confirmScreen,
  profile: profileScreen,
  phase: phaseScreen,
  routine: routineScreen,
  weight: weightScreen,
  weigh: weighScreen,
  route: routeScreen,
  progress: progressOther,
  routines: routinesScreen,
  exercises: exercisesScreen,
  workout: workoutStub,
};

function render(top = false) {
  const scroller = document.getElementById('phone-scroll');
  const keep = scroller.scrollTop;
  scroller.innerHTML = SCREENS[S.screen]() + sheet();
  scroller.scrollTop = top ? 0 : keep;
  const bar = scroller.querySelector('.m2-bar');
  scroller.style.setProperty('--bar-h', `${bar ? bar.offsetHeight : 0}px`);
  renderSide();
}

function snapshot() {
  return { screen: S.screen, foodId: S.foodId, eodDay: S.eodDay, adjust: S.adjust, replace: S.replace, batch: S.batch, candidate: S.candidate };
}

function go(screen, { push = true } = {}) {
  if (push && S.screen !== screen) S.stack.push(snapshot());
  S.screen = screen;
  S.flash = '';
  render(true);
}

function root(screen) {
  S.stack = [];
  S.sheet = null;
  go(screen, { push: false });
}

function back(message = '') {
  const prev = S.stack.pop();
  if (prev === undefined) return root('today');
  Object.assign(S, prev);
  S.flash = message;
  render(true);
}

function newCandidate(kind) {
  if (kind === 'barcode')
    return { name: 'Whey protein, chocolate', brand: 'Myprotein', sourceLine: 'BARCODE · OPEN FOOD FACTS', basis: 'serving', basisGrams: 30, printed: { kcal: 118, p: 22, c: 3.2, f: 1.9, fib: null }, state: 'raw', group: '', manual: false };
  if (kind === 'label')
    return { name: 'Greek yogurt, plain', brand: 'Oikos', sourceLine: 'LABEL PHOTO · READ 12:14', basis: 'package', basisGrams: 113, printed: { kcal: 92, p: 11.6, c: 4.6, f: 3.0, fib: null }, state: 'raw', group: '', manual: false };
  if (kind === 'partial')
    return { name: 'Greek yogurt, plain', brand: 'Oikos', sourceLine: 'LABEL PHOTO · PART READ', basis: 'package', basisGrams: 113, printed: { kcal: 92, p: 11.6, c: null, f: null, fib: null }, state: 'raw', group: '', manual: false, partial: true };
  return { name: '', brand: '', sourceLine: 'TYPED BY HAND', basis: '100g', basisGrams: null, printed: null, state: 'raw', group: '', manual: true };
}

function confirmMeal(iso, id, status) {
  statusesFor(iso)[id] = status;
  S.open = null;
}

const ACT = {
  noop() {},
  back: () => back(),
  tab({ tab }) {
    if (tab === 'food') return root(S.foodTab);
    if (tab === 'progress') return root(S.progTab === 'weight' ? 'weight' : 'progress');
    root(tab);
  },
  go: ({ id }) => go(id),
  foodTab({ id }) {
    S.foodTab = id;
    root(id);
  },
  progTab({ id }) {
    S.progTab = id;
    root(id === 'weight' ? 'weight' : 'progress');
  },
  openMeal({ id }) {
    S.open = S.open === id ? 'none' : id;
    render();
  },
  eaten({ id }) {
    confirmMeal(dayIso(), id, 'as_planned');
    S.flash = 'Eaten as planned. Counted in the day.';
    render();
  },
  skip({ id }) {
    confirmMeal(dayIso(), id, 'skipped');
    S.flash = 'Skipped. Nothing counted for it; the day can still be complete.';
    render();
  },
  unconfirm({ id }) {
    confirmMeal(dayIso(), id, 'planned');
    render();
  },
  adjustOpen({ id, day }) {
    const iso = day ?? (S.screen === 'eod' ? S.eodDay : dayIso());
    const meal = planFor(iso).find((m) => m.id === id);
    S.adjust = { iso, mealId: id, items: meal.items.map((i) => [...i]), refused: false };
    go('adjust');
  },
  adjustStep({ i, d }) {
    const item = S.adjust.items[Number(i)];
    const next = item[1] + Number(d);
    if (next <= 0) {
      S.adjust.refused = true;
      return render();
    }
    S.adjust.refused = false;
    item[1] = next;
    render();
  },
  adjustSwap({ i, id }) {
    S.adjust.items[Number(i)][0] = id;
    render();
  },
  adjustSave() {
    confirmMeal(S.adjust.iso, S.adjust.mealId, 'adjusted');
    back('Saved as eaten, adjusted. It replaces the plan for this meal.');
  },
  replaceOpen({ id, day }) {
    const iso = day ?? (S.screen === 'eod' ? S.eodDay : dayIso());
    S.replace = { iso, mealId: id, mode: 'list', q: '', picked: [] };
    go('replace');
  },
  replaceMode({ id }) {
    S.replace.mode = id;
    render();
  },
  replacePick({ id }) {
    const found = S.replace.picked.find((p) => p[0] === id);
    if (found) found[1] += 100;
    else S.replace.picked.push([id, 100]);
    render();
  },
  replaceDrop({ id }) {
    S.replace.picked = S.replace.picked.filter((p) => p[0] !== id);
    render();
  },
  replaceSave() {
    confirmMeal(S.replace.iso, S.replace.mealId, 'replaced');
    back('Saved as replaced. The planned meal no longer counts.');
  },
  startWorkout() {
    go('workout');
  },
  eodOpen({ id }) {
    S.eodDay = id;
    go('eod');
  },
  eodEaten({ id }) {
    confirmMeal(S.eodDay, id, 'as_planned');
    render();
  },
  eodSkip({ id }) {
    confirmMeal(S.eodDay, id, 'skipped');
    render();
  },
  eodAll() {
    for (const m of unconfirmed(S.eodDay)) statusesFor(S.eodDay)[m.id] = 'as_planned';
    back(`${dayLabel(S.eodDay)} is a complete day. It counts towards the maintenance check.`);
  },
  eodLeave() {
    S.eodLeft[S.eodDay] = true;
    back(`${dayLabel(S.eodDay)} is left incomplete. It won’t ask again.`);
  },
  sheet({ id }) {
    S.sheet = id;
    render();
  },
  sheetClose(_, el, event) {
    if (el.classList.contains('sheet-scrim') && event.target !== el) return;
    S.sheet = null;
    render();
  },
  prepTick({ id }) {
    if (S.prepDone[id]) {
      delete S.prepDone[id];
      return render();
    }
    S.prepDone[id] = true;
    const [day, foodId] = id.split('-');
    const p = PREP.find((x) => String(x.day) === day && x.food === foodId);
    S.batch = { food: foodId, on: WEEK.cookDays[Number(day)], raw: String(p.raw), cooked: '', keeps: String(food(foodId).keeps), fromPrep: true, refused: false };
    go('batch');
  },
  groceryTick({ id }) {
    if (S.groceryDone[id]) delete S.groceryDone[id];
    else S.groceryDone[id] = true;
    render();
  },
  groceryClear() {
    S.groceryDone = {};
    render();
  },
  foodOpen({ id }) {
    S.foodId = id;
    go('food');
  },
  archive() {
    back(`${food(S.foodId).name} archived. Past plans still name it.`);
  },
  addFood() {
    S.addQ = '';
    go('add');
  },
  mextPick({ id }) {
    const m = MEXT.find((x) => x.code === id);
    const existing = FOODS.find((f) => f.ref === m.code);
    S.candidate = { name: m.en, brand: '', sourceLine: `MEXT FOOD TABLE · ${m.code}`, basis: '100g', basisGrams: 100, printed: { kcal: m.kcal, p: m.p, c: m.c, f: m.f, fib: m.fib }, state: m.en.includes('raw') ? 'raw' : 'cooked', group: '', manual: false, duplicate: existing?.id };
    go('confirm');
  },
  scanOutcome({ id }) {
    S.scan = id;
    S.scanned = false;
    render();
  },
  scan() {
    if (S.scan === 'found') {
      S.candidate = newCandidate('barcode');
      return go('confirm');
    }
    S.scanned = true;
    render();
  },
  labelOpen() {
    S.labelStep = 'aim';
    go('label');
  },
  labelOutcome({ id }) {
    S.label = id;
    S.labelStep = 'aim';
    render();
  },
  labelShoot() {
    S.labelStep = 'reading';
    render();
    setTimeout(() => {
      if (S.screen !== 'label') return;
      if (S.label === 'read') {
        S.candidate = newCandidate('label');
        S.labelStep = 'aim';
        return go('confirm');
      }
      S.labelStep = 'done';
      render();
    }, 1100);
  },
  labelRetake() {
    S.labelStep = 'aim';
    render();
  },
  labelPartial() {
    S.candidate = newCandidate('partial');
    go('confirm');
  },
  manualOpen() {
    S.candidate = newCandidate('manual');
    go('confirm');
  },
  basis({ id }) {
    S.candidate.basis = id;
    render();
  },
  cState({ id }) {
    S.candidate.state = id;
    render();
  },
  saveFood() {
    const c = S.candidate;
    const k = c.basisGrams ? 100 / c.basisGrams : 1;
    const per = (x) => (c.printed?.[x] == null ? 0 : Math.round(c.printed[x] * k * 10) / 10);
    if (!c.duplicate && c.name) FOODS.unshift({ id: `new${FOODS.length}`, name: c.name, brand: c.brand || null, state: c.state, kcal: per('kcal'), p: per('p'), c: per('c'), f: per('f'), fib: per('fib'), source: 'manual', ref: null, group: c.group || null, keeps: null, cooked: false });
    S.setup.foods = true;
    S.emptyFoods = false;
    S.foodTab = 'foods';
    S.stack = [];
    S.screen = 'foods';
    S.flash = `${S.candidate.name || 'The food'} is on your list, saved per 100 g.`;
    render(true);
  },
  batchOpen({ id }) {
    const f = id ?? 'chicken';
    S.batch = { food: f, on: TODAY, raw: '', cooked: '', keeps: String(food(f).keeps), fromPrep: false, refused: false };
    go('batch');
  },
  batchSave() {
    if (!(Number(S.batch.raw) > 0 && Number(S.batch.cooked) > 0)) {
      S.batch.refused = true;
      return render();
    }
    const y = Math.round((Number(S.batch.cooked) / Number(S.batch.raw)) * 100);
    back(`Batch saved: yield ${y}%. Plans made from now on use it.`);
  },
  profileOpen: () => go('profile'),
  setupDone({ id }) {
    S.setup[id] = true;
    back();
  },
  phaseOpen() {
    S.phaseForm = { type: PHASE.type, rate: String(PHASE.ratePct), protein: String(PHASE.proteinPerKg), fat: String(PHASE.fatPct), kcal: String(PHASE.kcal) };
    go('phase');
  },
  phaseType({ id }) {
    S.phaseForm.type = id;
    S.phaseForm.rate = id === 'bulk' ? '0.25' : '0.5';
    render();
  },
  phaseSave() {
    if (!S.setup.phase) {
      S.setup.phase = true;
      return back();
    }
    back('Targets saved. Today’s unconfirmed meals were planned again.');
  },
  routineOpen() {
    S.routineForm = structuredClone(ROUTINE);
    go('routine');
  },
  routineDay({ id }) {
    S.routineDay = id;
    render();
  },
  weekday({ id }) {
    const d = Number(id);
    const list = S.routineForm.weekdays;
    S.routineForm.weekdays = list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort();
    render();
  },
  mealCount({ d }) {
    const r = S.routineForm[S.routineDay];
    r.meals = Math.min(6, Math.max(2, r.meals + Number(d)));
    render();
  },
  routineSave() {
    if (!S.setup.routine) {
      S.setup.routine = true;
      S.generating = true;
      back();
      setTimeout(() => {
        S.generating = false;
        if (S.screen === 'today') render();
      }, 1400);
      return;
    }
    back('Your day is saved. The coming days are planned again.');
  },
  weightSpan({ id }) {
    S.weightSpan = id;
    render();
  },
  weighOpen() {
    S.weigh = { kg: '', date: S.clock === 'morning' ? addDays(TODAY, 1) : TODAY, time: NOW[S.clock], refused: false };
    go('weigh');
  },
  weighSave() {
    const kg = Number(String(S.weigh.kg).replace(',', '.'));
    if (!(kg >= 20 && kg <= 300)) {
      S.weigh.refused = true;
      return render();
    }
    back(`Weigh-in saved: ${n1(kg)} kg at ${S.weigh.time}.`);
  },
  applyAsk() {
    S.sheet = 'apply';
    render();
  },
  applyDo() {
    const m = maintenance();
    S.applied = Math.round(m.kcal / 10) * 10 - Math.round(((PHASE.ratePct / 100) * PROFILE.weightKg * 7700) / 7 / 10) * 10;
    S.sheet = null;
    S.flash = 'Applied. Your calories are now measured, not provisional. The week was planned again.';
    render();
  },
  route({ id }) {
    S.route = id;
    render();
  },
  routeState({ id }) {
    S.routeState = id;
    render();
  },
  routeConnect() {
    S.routeState = 'synced';
    render();
  },
  routeToken() {
    S.token = true;
    render();
  },
};

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-act]');
  if (el === null || el.disabled) return;
  const action = ACT[el.dataset.act] ?? SIDE_ACT[el.dataset.act];
  if (action === undefined) return;
  event.preventDefault();
  action(el.dataset, el, event);
});

// Typing redraws only what depends on it, so the field keeps focus.
document.addEventListener('input', (event) => {
  const el = event.target;
  const key = el.dataset.field;
  if (key === undefined) return;
  if (key === 'foodQ') {
    S.foodQ = el.value;
    document.getElementById('foods-list').innerHTML = foodRowsList(FOODS.filter((f) => f.name.toLowerCase().includes(el.value.trim().toLowerCase())), el.value.trim().toLowerCase());
  } else if (key === 'addQ') {
    S.addQ = el.value;
    const scroller = document.getElementById('phone-scroll');
    const tmp = document.createElement('div');
    tmp.innerHTML = addScreen();
    document.getElementById('add-results').innerHTML = tmp.querySelector('#add-results').innerHTML;
    scroller.querySelector('#add-results');
  } else if (key === 'replaceQ') {
    S.replace.q = el.value;
  } else if (key.startsWith('batch')) {
    const map = { batchRaw: 'raw', batchCooked: 'cooked', batchKeeps: 'keeps', batchOn: 'on', batchFood: 'food' };
    S.batch[map[key]] = el.value;
    if (key === 'batchFood') return render();
    const raw = Number(S.batch.raw);
    const cooked = Number(S.batch.cooked);
    document.getElementById('yield-box').innerHTML = yieldBox(raw > 0 && cooked > 0 ? cooked / raw : null);
  } else if (['rate', 'protein', 'fat', 'kcal'].includes(key)) {
    S.phaseForm[key] = el.value;
  } else if (key === 'wKg') S.weigh.kg = el.value;
  else if (key === 'wTime') {
    S.weigh.time = el.value;
    document.getElementById('weigh-hint').textContent = el.value < '10:00' ? 'Before 10:00, so it counts as this morning’s weigh-in, unless the scale sent an earlier one.' : 'After 10:00. It counts for the day only if there is no reading before 10:00, and is marked as not a morning weigh-in.';
  } else if (key === 'wDate') S.weigh.date = el.value;
  else if (key === 'cBasisG') S.candidate.basisGrams = Number(el.value) || null;
  else if (key === 'cName') S.candidate.name = el.value;
});

// The phase and replace forms redraw their derived lines once a value is complete.
document.addEventListener('change', (event) => {
  const key = event.target.dataset.field;
  if (['rate', 'protein', 'fat', 'kcal', 'replaceQ', 'batchFood'].includes(key)) render();
  if (key === 'cGroup') S.candidate.group = event.target.value;
});
