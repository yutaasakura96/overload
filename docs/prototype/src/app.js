// The clickable prototype: plain functions that return the screen's HTML from one state object.
// Nothing here is product code. Class names are the app's own (apps/web/src/styles.css).

const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtW = (w) => String(Math.round(w * 100) / 100);
const fmt1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const trim1 = (v) => String(Math.round(v * 10) / 10);
const signed = (v, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateLabel = (isoDate, day = true) => {
  const d = toDate(isoDate);
  return `${day ? `${DAYS[d.getUTCDay()]} ` : ''}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const ago = (isoDate) => {
  const days = daysBetween(isoDate, TODAY);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 14 ? `${days} days ago` : `${Math.round(days / 7)} weeks ago`;
};
const clock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : word === word.toUpperCase() ? "S" : "s"}`;
const range = (ex) => (ex.lo === ex.hi ? String(ex.lo) : `${ex.lo}–${ex.hi}`);

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

const S = {
  screen: 'today',
  stack: [],
  progTab: 'history',
  live: null,
  full: false,
  rirOpen: false,
  histCount: 14,
  detailId: null,
  exId: 'bench',
  exSpan: '12w',
  strengthSpan: '12w',
  balanceMode: 'avg',
  balanceOpen: null,
  edit: null,
  flash: '',
  sheet: null,
  created: {},
  focusSteps: {},
  focusDone: false,
  filter: { split: 'all', group: 'all', q: '' },
};

// ---------------------------------------------------------------- shared parts

const synced = '<output class="data-state"><span class="data-state__dot" aria-hidden="true"></span>SYNCED 18:31</output>';

function appBar({ title, subline, back = false, sticky = false }) {
  return `<header class="app-bar${back ? ' app-bar--back' : ''}${sticky ? ' app-bar--sticky' : ''}">
    <div class="app-bar__lead">
      ${back ? `<button type="button" class="app-bar__back" data-act="back">${chevron('back')}<span class="visually-hidden">Back</span></button>` : ''}
      <div><h1 class="app-bar__title">${esc(title)}</h1>${subline === undefined ? '' : `<div class="app-bar__subline">${subline}</div>`}</div>
    </div>${synced}</header>`;
}

function tabs(current) {
  const list = [['today', 'Today'], ['progress', 'Progress'], ['routines', 'Routines'], ['exercises', 'Exercises']];
  return `<nav class="tabs" aria-label="Sections">${list
    .map(([id, label]) => `<button type="button" class="tabs__tab" data-act="tab" data-tab="${id}"${id === current ? ' aria-current="page"' : ''}>${label}</button>`)
    .join('')}</nav>`;
}

function segments(items, current, act, extra = '') {
  return `<div class="segments ${extra}" role="group">${items
    .map(([id, label]) => `<button type="button" class="segments__segment" data-act="${act}" data-id="${id}" aria-pressed="${id === current}">${label}</button>`)
    .join('')}</div>`;
}

const progressTabs = (current) =>
  segments([['history', 'History'], ['strength', 'Strength'], ['balance', 'Balance']], current, 'progTab', 'segments--three segments--sub');

function field(label, key, value, unit) {
  return `<div class="field field--number"><div class="field__label-row"><label class="field__label" for="edit-${key}">${label}</label></div>
    <div class="field__figure"><input id="edit-${key}" class="field__input field__input--number" type="text" inputmode="${key === 'w' ? 'decimal' : 'numeric'}" autocomplete="off" data-edit="${key}" value="${esc(value)}"${key === 'rir' ? ' placeholder="—"' : ''}>${unit ? `<span class="field__unit" aria-hidden="true">${unit}</span>` : ''}</div></div>`;
}

/** The editor a logged set opens into: the same one in the workout and in history (#48). */
function setEditor(label) {
  const e = S.edit;
  const error = e.error ? `<div class="field__error" role="alert">${info(12, 'var(--error)')}<span class="field__error-word">Refused</span><span>${esc(e.error)}</span></div>` : '';
  const actions = e.confirm
    ? `<fieldset class="confirm"><legend class="confirm__question">Delete ${esc(label)}? It leaves this workout, your charts and last time.</legend>
        <div class="confirm__actions"><button type="button" class="button button--tertiary" data-act="editKeep">Keep</button><button type="button" class="button button--secondary" data-act="editDelete">Delete</button></div></fieldset>`
    : `<div class="confirm__actions"><button type="button" class="button button--tertiary" data-act="editCancel">Cancel</button><button type="button" class="button button--primary" data-act="editSave">Save set</button></div>
       <button type="button" class="button button--tertiary set-edit__delete" data-act="editAskDelete">Delete set</button>`;
  return `<div class="set-edit" role="group" aria-label="Edit ${esc(label)}">
    <div class="refused__fields">${field('Kg', 'w', e.w, 'kg')}${field('Reps', 'r', e.r)}${field('RIR', 'rir', e.rir)}</div>${error}${actions}</div>`;
}

function evidenceTag(claim, sheet) {
  return `<button type="button" class="evidence" data-act="sheet" data-id="${sheet}"><span>${claim}</span><span class="evidence__divider"></span><span class="evidence__strength">MODERATE</span><span class="visually-hidden">: open the sources</span></button>`;
}

const SHEETS = {
  volume: {
    tag: '10–20 SETS',
    claim: 'Ten to twenty working sets a week per muscle group is a sound range to grow in.',
    means:
      'Moderate: the studies agree that more weekly sets bring more growth with shrinking returns, but they are few, mostly on young men, and none tests your exact split. Under 10 is not wasted, it is just under the range. Sets that train a muscle indirectly count as half.',
    sources: [
      ['Dose-response relationship between weekly resistance training volume and increases in muscle mass', 'Schoenfeld, Ogborn & Krieger · J Sports Sci · 2017'],
      ['A systematic review of the effects of different resistance training volumes on muscle hypertrophy', 'Baz-Valle et al. · J Hum Kinet · 2022'],
      ['The resistance training dose response: meta-regressions of weekly volume and frequency', 'Pelland et al. · Sports Med · 2026'],
    ],
  },
  variation: {
    tag: 'VARIATION',
    claim: 'Swapping a stalled exercise for a close variation can restart progress.',
    means:
      'Moderate: some planned variation helps strength and growth across a muscle, while changing exercises often, or at random, can hold gains back. So the app suggests one swap, and only for a lift that has stopped gaining.',
    sources: [['Does varying resistance exercises promote superior muscle hypertrophy and strength gains? A systematic review', 'Kassiano et al. · J Strength Cond Res · 2022']],
  },
};

function sheet() {
  if (S.sheet === null) return '';
  const s = SHEETS[S.sheet];
  return `<div class="sheet-scrim" data-act="sheetClose"><div class="sheet" role="dialog" aria-label="Evidence" data-act="noop">
    <div class="sheet__head"><h2 class="section-label">Evidence</h2><button type="button" class="sheet__close" data-act="sheetClose">CLOSE</button></div>
    <div><span class="evidence" style="pointer-events:none"><span>${s.tag}</span><span class="evidence__divider"></span><span class="evidence__strength">MODERATE</span></span></div>
    <p class="sheet__claim">${s.claim}</p><p class="sheet__means">${s.means}</p>
    <div><h3 class="section-label">Sources</h3><ul class="sheet__sources">${s.sources
      .map(([title, meta]) => `<li><span class="sheet__source-title">${title}</span><span class="sheet__source-meta">${meta}</span></li>`)
      .join('')}</ul></div></div></div>`;
}

// ---------------------------------------------------------------- the live workout (#47, #51)

function startWorkout(routine, preset) {
  S.live = {
    name: routine.name,
    routineId: routine.id,
    startedAt: Date.now(),
    cur: 0,
    seq: 0,
    rest: null,
    warm: false,
    finishing: false,
    refusal: '',
    exercises: routine.slots.map(([exId, target]) => ({ exId, target, sets: [], last: lastTime(exId), sug: suggestion(exId) })),
  };
  if (preset === 'mid') {
    const live = S.live;
    live.startedAt = Date.now() - 14 * 60000;
    const w = live.exercises[0].sug.weight;
    live.exercises[0].sets = [
      { id: 'L1', w: roundTo(w * 0.5, 2.5), r: 10, rir: null, warm: true },
      { id: 'L2', w: roundTo(w * 0.75, 2.5), r: 5, rir: null, warm: true },
      { id: 'L3', w, r: 10, rir: 2, warm: false },
      { id: 'L4', w, r: 10, rir: 1, warm: false },
    ];
    live.seq = 4;
    live.rest = { start: Date.now() - 42000, total: exById[live.exercises[0].exId].rest, extra: 0, dismissed: false };
  }
  openDraft();
}

const liveEntry = () => S.live.exercises[S.live.cur];
const isComplete = (entry) => working(entry.sets).length >= entry.target;
const setLabel = (entry) => {
  const n = working(entry.sets).length + 1;
  return n <= entry.target ? `SET ${n} OF ${entry.target}` : `SET ${n} · EXTRA`;
};

/** What the card opens on: the last set logged today, else last time's match, else the target. */
function openDraft() {
  const entry = liveEntry();
  const ex = exById[entry.exId];
  const done = working(entry.sets);
  const prev = done.at(-1);
  const match = entry.last?.sets[done.length];
  const w = prev?.w ?? entry.sug?.weight ?? (ex.inc === 0 ? 0 : '');
  const r = prev?.r ?? (entry.sug?.up ? ex.lo : (match?.r ?? ''));
  const rir = prev?.rir ?? (entry.sug?.up ? '' : (match?.rir ?? ''));
  S.live.draft = { w: w === '' ? '' : fmtW(w), r: String(r), rir: rir === null ? '' : String(rir) };
  S.live.warm = false;
  S.live.refusal = '';
}

function restState() {
  const rest = S.live?.rest;
  if (!rest || rest.dismissed) return null;
  const total = rest.total + rest.extra;
  const elapsed = (Date.now() - rest.start) / 1000;
  return { total, elapsed, remaining: total - elapsed, over: total - elapsed <= 0 };
}

/** #47: what was done last time, and what to aim for today, in words. */
function brief(entry, compact = false) {
  const ex = exById[entry.exId];
  const { last, sug } = entry;
  if (last === null) {
    return `<div class="brief${compact ? ' brief--compact' : ''}">
      <div class="brief__row"><div class="brief__head"><span class="brief__label">Last time</span></div>
        <div class="brief__figures">None yet</div>
        ${compact ? '' : `<p class="brief__why">This is your first time logging ${esc(ex.name)}, so there is nothing to compare with.</p>`}</div>
      <div class="brief__row brief__row--target"><div class="brief__head"><span class="brief__label">Today's target</span><span class="brief__tag">FIRST WORKOUT</span></div>
        <div class="brief__figures">Find your weight <span class="brief__unit">× ${range(ex)}</span></div>
        <p class="brief__why">Pick a weight you can lift for ${range(ex)} reps with one to three left in you. From the next workout, this line shows what you did and what to aim for.</p></div></div>`;
  }
  const same = last.sets.every((s) => s.w === last.sets[0].w);
  const figures = same
    ? `${fmtW(last.sets[0].w)} <span class="brief__unit">kg ×</span> ${last.sets.map((s) => s.r).join(' · ')}`
    : last.sets.map((s) => `${fmtW(s.w)}×${s.r}`).join(' · ');
  const n = last.sets.length;
  const short = last.sets.filter((s) => s.r < ex.hi).length;
  const why = sug.up
    ? `You reached ${ex.hi} reps on every set last time, so the weight goes up by ${fmtW(ex.inc)} kg. Aim for ${ex.lo} or more.`
    : `${short === n ? `All ${n} sets` : `${plural(short, 'set')} of ${n}`} stopped short of ${ex.hi} reps last time. Reach ${ex.hi} on all ${n} and next time goes up to ${fmtW(sug.weight + ex.inc)} kg.`;
  return `<div class="brief${compact ? ' brief--compact' : ''}">
    <button type="button" class="brief__row" data-act="exercise" data-id="${ex.id}">
      <span class="brief__head"><span class="brief__label">Last time</span><span class="brief__when">${dateLabel(last.date).toUpperCase()} · ${ago(last.date).toUpperCase()}</span></span>
      <span class="brief__head"><span class="brief__figures">${figures}</span><span class="brief__more">${chevron()}<span class="visually-hidden">All past sets</span></span></span>
    </button>
    <div class="brief__row brief__row--target"><div class="brief__head"><span class="brief__label">Today's target</span><span class="brief__tag">${sug.up ? `+${fmtW(ex.inc)} KG` : 'SAME WEIGHT'}</span></div>
      <div class="brief__figures">${fmtW(sug.weight)} <span class="brief__unit">kg ×</span> ${range(ex)}</div>
      ${compact ? '' : `<p class="brief__why">${why}</p>`}</div></div>`;
}

function figure(key, label, value, placeholder, decimal) {
  const chars = Math.max(1, (value || placeholder).length);
  return `<div class="figure" style="--chars:${chars}"><label for="fig-${key}" class="figure__label">${label}</label>
    <input id="fig-${key}" class="figure__input" type="text" inputmode="${decimal ? 'decimal' : 'numeric'}" autocomplete="off" data-draft="${key}" data-placeholder="${placeholder}" value="${esc(value)}" placeholder="${placeholder}"></div>`;
}

function rirHelp() {
  return `<div class="rir-help"><p class="rir-help__line"><span class="rir-help__term">RIR</span> is reps in reserve: how many more reps you could have done. Optional.
      <button type="button" class="rir-help__toggle" data-act="rir" aria-expanded="${S.rirOpen}">${S.rirOpen ? 'Hide guide' : 'How to gauge it'}</button></p>
    ${
      S.rirOpen
        ? `<div class="rir-help__guide"><p class="rir-help__ask">After the set, ask: how many more good reps could I have done?</p>
        <dl class="rir-help__scale"><dt>0</dt><dd>Could not do another. The last rep was a grind.</dd><dt>1–2</dt><dd>Hard. One or two more would have been possible.</dd><dt>3+</dt><dd>Comfortable. Plenty left.</dd></dl>
        <p class="rir-help__ask">Not sure? Leave it empty. The set still counts.</p></div>`
        : ''
    }</div>`;
}

function activeSet(entry) {
  const ex = exById[entry.exId];
  const { draft, warm, refusal } = S.live;
  const match = entry.last?.sets[working(entry.sets).length];
  const lastWord =
    entry.last === null
      ? '<span class="active-set__last-word">FIRST WORKOUT</span>'
      : match === undefined || warm
        ? ''
        : `<span class="active-set__last"><span class="active-set__last-word">LAST TIME</span>${fmtW(match.w)} × ${match.r}</span>`;
  return `<section class="active-set" aria-label="Current set">
    <div class="active-set__label-row"><span class="active-set__label">${warm ? 'WARM-UP' : setLabel(entry)}</span>${lastWord}</div>
    <div class="active-set__figures">${figure('w', 'KG', draft.w, '—', true)}${figure('r', 'REPS', draft.r, String(ex.lo))}${figure('rir', 'RIR', draft.rir, '—')}</div>
    ${rirHelp()}
    ${refusal ? `<div class="field__error" role="alert">${info(12, 'var(--error)')}<span class="field__error-word">Refused</span><span>${esc(refusal)}</span></div>` : ''}
    <div class="active-set__actions">
      <button type="button" class="active-set__warm" data-act="warm" aria-pressed="${warm}"><span aria-hidden="true">WARM</span><span class="visually-hidden">Warm-up set</span></button>
      <button type="button" class="button button--primary active-set__complete" data-act="complete">${check(22)}Complete set</button>
    </div></section>`;
}

function setsTable(entry) {
  const rows = entry.sets.filter((s) => !s.warm);
  const warmups = entry.sets.filter((s) => s.warm);
  const warm =
    warmups.length === 0
      ? ''
      : `<div class="warmups"><div class="warmups__summary"><span class="warmups__label">${check(13, 'var(--done)')}${warmups.length} ${warmups.length === 1 ? 'WARM-UP SET' : 'WARM-UP SETS'}</span>
          <span class="warmups__figures">${warmups.map((s) => `${fmtW(s.w)} × ${s.r}`).join(' · ')}</span></div></div>`;
  if (rows.length === 0) return warm;
  return `${warm}<table class="sets" aria-label="Completed sets"><thead><tr class="sets__row sets__row--head">
      <th scope="col">Set</th><th scope="col">Last</th><th scope="col">KG</th><th scope="col">Reps</th><th scope="col">RIR</th><th scope="col"><span class="visually-hidden">Edit</span></th></tr></thead><tbody>
    ${rows
      .map((set, index) => {
        const last = entry.last?.sets[index];
        const editing = S.edit?.setId === set.id;
        return `<tr class="sets__row"><td class="sets__number">${index + 1}</td><td class="sets__last">${last === undefined ? '' : `${fmtW(last.w)} × ${last.r}`}</td>
          <td class="sets__figure">${fmtW(set.w)}</td><td class="sets__figure">${set.r}</td><td class="sets__number">${set.rir ?? '—'}</td>
          <td class="sets__check"><button type="button" class="check-cell check-cell--done sets__edit" data-act="editLive" data-id="${set.id}" aria-expanded="${editing}">${check(17, 'var(--done)')}<span class="visually-hidden">Set ${index + 1} done. Edit</span></button></td></tr>
          ${editing ? `<tr class="sets__row sets__row--editor"><td colspan="6">${setEditor(`set ${index + 1}`)}</td></tr>` : ''}`;
      })
      .join('')}</tbody></table>`;
}

function exerciseList(label, entries) {
  if (entries.length === 0) return '';
  return `<section class="up-next"><h2 class="section-label">${label}</h2><ul class="up-next__list">${entries
    .map((entry) => {
      const ex = exById[entry.exId];
      const logged = working(entry.sets).length;
      return `<li><button type="button" class="up-next__row" data-act="openExercise" data-id="${S.live.exercises.indexOf(entry)}">
        <span class="up-next__name">${esc(ex.name)}</span><span class="up-next__target">${logged > 0 ? `${logged} / ` : ''}${entry.target} × ${range(ex)}</span></button></li>`;
    })
    .join('')}</ul></section>`;
}

function dock() {
  const rest = restState();
  const entry = liveEntry();
  const full = (wide) => `<button type="button" class="dock__full${wide ? ' dock__full--wide' : ''}" data-act="full">${wide ? 'FULL SCREEN' : 'FULL<br>SCREEN'}</button>`;
  if (rest === null) {
    return `<section class="rest-bar dock" aria-label="Rest timer"><div class="rest-bar__track"></div><div class="rest-bar__body">
      <div><div class="rest-bar__label">REST TIMER</div><div class="dock__idle">Starts by itself after each set: <b>${clock(exById[entry.exId].rest)}</b></div></div>
      <div class="rest-bar__actions">${full(true)}</div></div></section>`;
  }
  return `<section class="rest-bar dock${rest.over ? ' rest-bar--over' : ''}" aria-label="Rest timer">
    <div class="rest-bar__track"><div class="rest-bar__fill" data-rest-fill style="width:${rest.over ? 100 : Math.min(100, (rest.elapsed / rest.total) * 100)}%"></div></div>
    <div class="rest-bar__body"><div><div class="rest-bar__label">${rest.over ? 'REST OVER' : 'REST'} · NEXT: ${setLabel(entry)}</div>
      <div class="rest-bar__timer dock__timer" role="timer" data-rest>${rest.over ? `+${clock(-rest.remaining)}` : clock(Math.ceil(rest.remaining))}</div></div>
      <div class="rest-bar__actions">${full(false)}${rest.over ? '' : '<button type="button" class="rest-bar__extend" data-act="extend">+30s</button>'}
        <button type="button" class="rest-bar__skip" data-act="skip">${rest.over ? 'DISMISS' : 'SKIP'}</button></div></div></section>`;
}

function finishBlock() {
  const count = S.live.exercises.reduce((n, e) => n + e.sets.length, 0);
  if (!S.live.finishing) return '<div class="workout__finish"><button type="button" class="button button--tertiary" data-act="finishAsk">Finish workout</button></div>';
  return `<div class="workout__finish"><fieldset class="confirm"><legend class="confirm__question">${
    count === 0 ? `Finish ${esc(S.live.name)}? No sets are logged, so nothing is kept.` : `Finish ${esc(S.live.name)}? ${plural(count, 'set')} logged.`
  }</legend><div class="confirm__actions"><button type="button" class="button button--tertiary" data-act="finishKeep">Keep going</button><button type="button" class="button button--secondary" data-act="finish">Finish</button></div></fieldset></div>`;
}

const elapsedLine = () => `<span data-elapsed>${clock((Date.now() - S.live.startedAt) / 1000)}</span> elapsed`;

function workoutScreen() {
  if (S.live === null) return todayScreen();
  if (S.full) return fullScreen();
  const live = S.live;
  const entry = liveEntry();
  const ex = exById[entry.exId];
  const others = live.exercises.filter((e) => e !== entry);
  return `<main class="workout">${appBar({ title: live.name, subline: elapsedLine(), sticky: true })}
    <section><div class="exercise-head"><h2 class="exercise-head__name">${esc(ex.name)}</h2><span class="exercise-head__meta">${live.cur + 1} OF ${live.exercises.length}</span></div>
      ${brief(entry)}${setsTable(entry)}${activeSet(entry)}</section>
    ${exerciseList('Up next', others.filter((e) => !isComplete(e)))}${exerciseList('Done', others.filter(isComplete))}
    ${finishBlock()}${dock()}</main>`;
}

/** #51: nothing on screen but the current set, or the rest countdown and what comes after it. */
function fullScreen() {
  const live = S.live;
  const entry = liveEntry();
  const ex = exById[entry.exId];
  const rest = restState();
  const match = entry.last?.sets[working(entry.sets).length];
  const body =
    rest === null
      ? `${brief(entry, true)}${activeSet(entry)}`
      : `<section class="rest-hero${rest.over ? ' rest-hero--over' : ''}" aria-label="Rest timer">
          <div><div class="rest-bar__label">${rest.over ? 'REST OVER' : 'REST'}</div><div class="rest-hero__timer" role="timer" data-rest>${rest.over ? `+${clock(-rest.remaining)}` : clock(Math.ceil(rest.remaining))}</div></div>
          <div class="rest-bar__track"><div class="rest-bar__fill" data-rest-fill style="width:${rest.over ? 100 : Math.min(100, (rest.elapsed / rest.total) * 100)}%"></div></div>
          ${
            rest.over
              ? `<div class="rest-hero__actions rest-hero__actions--one"><button type="button" class="button button--primary" data-act="skip">Start ${setLabel(entry).toLowerCase()}</button></div>`
              : `<div class="rest-hero__actions"><button type="button" class="button button--secondary" data-act="extend">+30s</button><button type="button" class="button button--primary" data-act="skip">Skip rest</button></div>`
          }</section>
        <section class="next-up"><h3 class="section-label" style="margin:0">Next · ${setLabel(entry)}</h3>
          <div class="next-up__figures">${S.live.draft.w === '' ? 'Find your weight' : `${S.live.draft.w} kg`} × ${S.live.draft.r || range(ex)}</div>
          <div class="brief__when">${match === undefined ? (entry.last === null ? 'FIRST WORKOUT OF THIS EXERCISE' : 'NO MATCHING SET LAST TIME') : `LAST TIME ${fmtW(match.w)} × ${match.r}`}</div></section>`;
  return `<main class="full"><header class="full__bar"><div><h1 class="app-bar__title">${esc(live.name)}</h1><div class="app-bar__subline">${elapsedLine()}</div></div>
      <button type="button" class="button button--tertiary" data-act="fullExit">Exit full screen</button></header>
    <div class="full__body"><div class="exercise-head"><h2 class="exercise-head__name">${esc(ex.name)}</h2></div>
      <div class="full__count">EXERCISE ${live.cur + 1} OF ${live.exercises.length} · ${working(entry.sets).length} OF ${entry.target} SETS DONE</div>
      ${body}
      <div class="full__foot"><button type="button" class="link-row" data-act="go" data-id="guide">
        <span><span class="link-row__name">${S.focusDone ? 'iPhone Focus: set up' : 'Calls and messages can still interrupt'}</span>
        <span class="link-row__meta">${S.focusDone ? 'Open the guide again' : 'Set up an iPhone Focus that lets only chosen people through'}</span></span>${chevron()}</button></div>
    </div></main>`;
}

function guideScreen() {
  const steps = [
    ['Create the Focus', 'Settings › Focus › Add › Custom', 'Name it Workout, choose a colour and an icon, tap Next, then Customize Focus. The same list has a ready-made Fitness Focus if you would rather start from that.'],
    ['Choose who can reach you', 'Workout › People › Allow Notifications From', 'Add the people whose calls and messages must get through. Turn on repeated calls too: a second call from the same person within three minutes then comes through.'],
    ['Choose which apps can notify', 'Workout › Apps › Allow Notifications From', 'Add only what you need, such as Phone and Messages. A web app on the Home Screen, Overload included, can be added here.'],
    ['Have it turn on at the gym', 'Workout › Add Schedule › Location', 'Pick your gym, and the Focus turns on when you arrive. A time of day works too, or turn it on yourself from Control Centre.'],
  ];
  return `<main>${appBar({ title: 'iPhone Focus', back: true })}
    <div class="notice notice--flag">${info(14)}<div><div class="notice__word">What Overload cannot do</div>A web app cannot turn a Focus on, or stop you opening other apps. iOS does that, so it is set up once in Settings. Full screen keeps the workout in front of you; the Focus keeps everything else quiet.</div></div>
    <ol class="guide">${steps
      .map(
        ([title, path, text], i) => `<li class="guide__step">
        <button type="button" class="check-cell${S.focusSteps[i] ? ' check-cell--done' : ''}" data-act="focusStep" data-id="${i}" aria-pressed="${Boolean(S.focusSteps[i])}">${check(15, S.focusSteps[i] ? 'var(--done)' : 'var(--line-control)')}<span class="visually-hidden">Step ${i + 1} done</span></button>
        <div><h2 class="guide__title">${i + 1}. ${title}</h2><p class="guide__path">${path}</p><p class="guide__text">${text}</p></div></li>`,
      )
      .join('')}</ol>
    <div class="section-actions" style="padding-bottom:10px"><button type="button" class="button button--primary" data-act="focusDone">I have set it up</button></div>
    <footer class="footnote" style="margin-top:14px"><span>Steps from Apple's iPhone User Guide, iOS 27</span><span class="footnote__formula">checked 10 Oct 2026</span></footer></main>`;
}

// ---------------------------------------------------------------- Today, as the hub

function todayScreen() {
  const latest = DB.workouts.at(-1);
  const overview = strengthOverview('12w');
  const count = (status) => overview.rated.filter((row) => row.status === status).length;
  const groups = balance('avg');
  const low = groups.filter((g) => g.status === 'low').length;
  const none = groups.filter((g) => g.status === 'none').length;
  const inProgress =
    S.live === null
      ? ''
      : `<section class="today__section"><h2 class="section-label">In progress</h2><div class="card card--active"><div><div class="card__title">${esc(S.live.name)}</div>
          <div class="card__meta">${plural(S.live.exercises.reduce((n, e) => n + e.sets.length, 0), 'SET')} · STARTED ${clock((Date.now() - S.live.startedAt) / 1000)} AGO</div></div>
          <button type="button" class="button button--primary" data-act="go" data-id="workout">Resume workout</button></div></section>`;
  return `<main>${appBar({ title: 'Today', subline: 'SAT 10 OCT' })}${tabs('today')}${inProgress}
    <section class="today__section"><h2 class="section-label">Start a workout</h2><ul class="starts">${DB.routines
      .map((routine) => {
        const last = DB.workouts.findLast((w) => w.routineId === routine.id);
        const sets = routine.slots.reduce((n, [, t]) => n + t, 0);
        return `<li><button type="button" class="starts__row" data-act="start" data-id="${routine.id}"><span class="routines__text"><span class="routines__name">${esc(routine.name)}</span>
          <span class="routines__meta">${plural(routine.slots.length, 'EXERCISE')} · ${sets} SETS</span>
          <span class="routines__preview">${last === undefined ? 'Not done yet' : `Last done ${dateLabel(last.date)}, ${ago(last.date)}`}</span></span><span class="starts__go">${S.live?.routineId === routine.id ? 'RESUME' : 'START'}</span></button></li>`;
      })
      .join('')}</ul></section>
    <section class="today__section"><h2 class="section-label">Last workout</h2>
      <button type="button" class="link-row link-row--flush" data-act="detail" data-id="${latest.id}"><span><span class="link-row__name">${esc(latest.name)} · ${dateLabel(latest.date)}</span>
        <span class="link-row__meta">${plural(latest.exercises.reduce((n, e) => n + working(e.sets).length, 0), 'working set')} · ${latest.minutes} min · ${ago(latest.date)}</span></span>${chevron()}</button></section>
    <section class="today__section"><h2 class="section-label">How it is going</h2>
      <button type="button" class="link-row link-row--flush" data-act="progTab" data-id="strength"><span><span class="link-row__name">Strength, last 12 weeks</span>
        <span class="link-row__meta"><span class="link-row__done">${count('gaining')} gaining</span> · ${count('holding')} holding · <span class="link-row__flag">${count('losing')} losing</span></span></span>${chevron()}</button>
      <button type="button" class="link-row link-row--flush" data-act="progTab" data-id="balance"><span><span class="link-row__name">Muscle balance, sets a week</span>
        <span class="link-row__meta"><span class="link-row__flag">${low} low · ${none} not trained</span> · ${groups.length - low - none} in range</span></span>${chevron()}</button></section>
    <p class="proto-note">Profile and account sit below, unchanged. Left out of the prototype.</p></main>`;
}

// ---------------------------------------------------------------- history (#48)

const topSet = (entry) => working(entry.sets).reduce((a, b) => (a === null || b.w > a.w || (b.w === a.w && b.r > a.r) ? b : a), null);

function historyScreen() {
  const list = DB.workouts.toReversed();
  const shown = list.slice(0, S.histCount);
  let month = '';
  const rows = shown
    .map((workout) => {
      const d = toDate(workout.date);
      const label = `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      const head = label === month ? '' : `${month === '' ? '' : '</ul>'}<h2 class="section-label section-label--gutter month-label">${label}</h2><ul class="routines routines--flush">`;
      month = label;
      const sets = workout.exercises.reduce((n, e) => n + working(e.sets).length, 0);
      const preview = workout.exercises
        .map((e) => {
          const top = topSet(e);
          return top === null ? '' : `${exById[e.exId].name} ${fmtW(top.w)} × ${top.r}`;
        })
        .filter(Boolean)
        .join(' · ');
      return `${head}<li><button type="button" class="routines__row" data-act="detail" data-id="${workout.id}"><span class="routines__text"><span class="routines__name">${esc(workout.name)}</span>
        <span class="routines__meta">${dateLabel(workout.date).toUpperCase()} · ${workout.minutes} MIN · ${sets} SETS</span><span class="routines__preview">${esc(preview)}</span></span><span class="routines__go">${chevron()}</span></button></li>`;
    })
    .join('');
  return `<main>${appBar({ title: 'Progress', subline: `${DB.workouts.length} WORKOUTS` })}${tabs('progress')}${progressTabs('history')}
    ${S.flash ? `<p class="saved-line" role="status">${check(13, 'var(--done)')}${esc(S.flash)}</p>` : ''}
    ${rows}</ul>
    ${shown.length < list.length ? '<div class="section-actions"><button type="button" class="button button--tertiary" data-act="earlier">Show earlier workouts</button></div>' : ''}
    <div style="height:24px"></div></main>`;
}

function detailScreen() {
  const workout = DB.workouts.find((w) => w.id === S.detailId);
  if (workout === undefined) return historyScreen();
  const all = workout.exercises.flatMap((e) => working(e.sets));
  const volume = all.reduce((n, s) => n + s.w * s.r, 0);
  const stat = (label, figure, unit) => `<div class="progress__stat"><dt class="progress__stat-label">${label}</dt><dd class="progress__stat-value"><span class="progress__stat-figure">${figure}</span><span class="progress__stat-unit">${unit}</span></dd></div>`;
  const blocks = workout.exercises
    .map((entry, exIdx) => {
      const ex = exById[entry.exId];
      let n = 0;
      const rows = entry.sets
        .map((set) => {
          const number = set.warm ? 'W' : String((n += 1));
          const label = set.warm ? 'the warm-up set' : `set ${number}`;
          const editing = S.edit?.setId === set.id;
          return `<li><button type="button" class="hsets__row${set.warm ? ' hsets__row--warm' : ''}" data-act="editHist" data-id="${set.id}" data-ex="${exIdx}" aria-expanded="${editing}">
            <span class="sets__number">${number}</span><span class="sets__figure">${fmtW(set.w)}</span><span class="sets__figure">${set.r}</span><span class="sets__number">${set.rir ?? '—'}</span><span class="hsets__edit">${editing ? 'CLOSE' : 'EDIT'}</span></button>
            ${editing ? setEditor(label) : ''}</li>`;
        })
        .join('');
      return `<section class="hx"><button type="button" class="hx__head" data-act="exercise" data-id="${ex.id}"><span class="hx__name">${esc(ex.name)}</span>${chevron()}</button>
        <div class="hsets__head" aria-hidden="true"><span>Set</span><span>KG</span><span>Reps</span><span>RIR</span><span></span></div><ul class="hsets">${rows}</ul></section>`;
    })
    .join('');
  return `<main>${appBar({ title: workout.name, subline: `${dateLabel(workout.date).toUpperCase()} · ${workout.start} · ${workout.minutes} MIN`, back: true })}
    ${S.flash ? `<p class="saved-line" role="status">${check(13, 'var(--done)')}${esc(S.flash)}</p>` : ''}
    <dl class="stat-strip">${stat('Working sets', all.length, '')}${stat('Volume', Math.round(volume).toLocaleString('en-GB'), 'kg')}${stat('Time', workout.minutes, 'min')}</dl>
    ${blocks}
    <p class="proto-note">Tap a set to change its weight, reps or RIR, or to delete it. Adding a set to a past workout, and changing its date, are not offered (open question Q8).</p><div style="height:24px"></div></main>`;
}

// ---------------------------------------------------------------- an exercise: chart and past sets (#48)

function e1rmChart(points, span) {
  const W = 358;
  const plot = { left: 24, right: W - 68 };
  const values = points.map((p) => p.e1rm);
  const min = Math.min(...values);
  const max = Math.max(...values);
  let step = 100;
  let top = 0;
  for (const candidate of [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50]) {
    top = Math.ceil(max / candidate) * candidate;
    if (min >= top - 2.55 * candidate) {
      step = candidate;
      break;
    }
  }
  const y = (v) => 26.7 + ((top - v) * 50) / step;
  const from = span === 'all' ? points[0].workout.date : addDays(TODAY, -SPAN_WEEKS[span] * 7);
  const total = Math.max(1, daysBetween(from, TODAY));
  const x = (date) => plot.left + ((plot.right - plot.left) * daysBetween(from, date)) / total;
  const xs = points.map((p) => x(p.workout.date));
  const ys = values.map(y);
  const ringed = xs.every((v, i) => i === 0 || v - xs[i - 1] >= 7);
  const last = points.length - 1;
  return `<div class="chart"><svg class="chart__canvas" width="100%" viewBox="0 0 ${W} 192" fill="none" aria-hidden="true">
    ${[26.7, 76.7, 126.7].map((gy, i) => `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" class="chart__gridline"/><text x="0" y="${gy - 4}" class="chart__label">${trim1(top - i * step)}</text>`).join('')}
    <line x1="0" y1="160" x2="${W}" y2="160" class="chart__baseline"/>
    <polyline points="${xs.map((v, i) => `${v.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')}" class="chart__line"/>
    ${ringed ? points.slice(0, last).map((_, i) => `<circle cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="2.5" class="chart__ring"/>`).join('') : ''}
    <circle cx="${xs[last].toFixed(1)}" cy="${ys[last].toFixed(1)}" r="3.5" class="chart__latest"/>
    <text x="${plot.left}" y="178" class="chart__label">${dateLabel(from, false).toUpperCase()}</text>
    <text x="${plot.right}" y="178" text-anchor="end" class="chart__label">${dateLabel(TODAY, false).toUpperCase()}</text></svg></div>`;
}

function exerciseScreen() {
  const ex = exById[S.exId];
  const points = inSpan(exerciseHistory(ex.id), S.exSpan);
  const latest = points.at(-1);
  const change = points.length > 1 ? latest.e1rm - points[0].e1rm : null;
  const spanWord = S.exSpan === 'all' ? 'ALL TIME' : `OVER ${S.exSpan.toUpperCase()}`;
  const top = points.reduce((a, p) => (a === null || p.top.w > a.w || (p.top.w === a.w && p.top.r > a.r) ? p.top : a), null);
  const volume = points.reduce((n, p) => n + p.volume, 0);
  const chart =
    points.length < 2
      ? `<div class="progress__empty"><h2 class="empty-state__title">Not enough data yet</h2><p class="empty-state__body">The chart needs two workouts with a working set of this exercise${S.exSpan === 'all' ? '.' : ' in this span.'}</p></div>`
      : e1rmChart(points, S.exSpan);
  const past =
    points.length === 0
      ? '<p class="empty">No sets logged in this span.</p>'
      : `<ul class="past">${points
          .toReversed()
          .map((p) => {
            const same = p.sets.every((s) => s.w === p.sets[0].w);
            const sets = same ? `${fmtW(p.sets[0].w)} × ${p.sets.map((s) => s.r).join(' · ')}` : p.sets.map((s) => `${fmtW(s.w)}×${s.r}`).join(' · ');
            return `<li><button type="button" class="past__row" data-act="detail" data-id="${p.workout.id}"><span class="past__date">${dateLabel(p.workout.date).toUpperCase()} · ${esc(p.workout.name).toUpperCase()}</span>
              <span class="past__e1rm">${fmt1(p.e1rm)}<small>E1RM</small></span><span class="past__sets">${sets}</span></button></li>`;
          })
          .join('')}</ul>`;
  return `<main class="progress">${appBar({ title: ex.name, back: true })}
    <section class="progress__headline"><div><h2 class="section-label">Estimated 1RM</h2><p class="progress__e1rm">${
      latest === undefined ? '<span class="progress__e1rm-unit">—</span>' : `<span class="progress__e1rm-figure">${fmt1(latest.e1rm)}</span> <span class="progress__e1rm-unit">kg</span>`
    }</p></div>${change === null ? '' : `<p class="progress__change"><span class="progress__change-figure${change > 0 ? ' progress__change-figure--up' : ''}">${signed(change)}</span><span class="progress__change-span">${spanWord}</span></p>`}</section>
    ${segments([['4w', '4W'], ['12w', '12W'], ['6m', '6M'], ['1y', '1Y'], ['all', 'ALL']], S.exSpan, 'exSpan', 'segments--spans')}
    <div class="progress__body">${chart}
      <dl class="progress__stats"><div class="progress__stat"><dt class="progress__stat-label">Top set</dt><dd class="progress__stat-value">${top === null ? '<span class="progress__stat-unit">—</span>' : `<span class="progress__stat-figure">${fmtW(top.w)}</span><span class="progress__stat-unit">× ${top.r}</span>`}</dd></div>
        <div class="progress__stat"><dt class="progress__stat-label">Volume load</dt><dd class="progress__stat-value">${points.length === 0 ? '<span class="progress__stat-unit">—</span>' : `<span class="progress__stat-figure">${Math.round(volume).toLocaleString('en-GB')}</span> <span class="progress__stat-unit">kg</span>`}</dd></div></dl>
      <h2 class="section-label section-label--gutter" style="margin-top:22px">Past sets · ${plural(points.length, 'workout')}</h2>${past}</div>
    <footer class="footnote"><span>e1RM from the best working set</span><span class="footnote__formula">Epley · w × (1 + r/30)</span></footer></main>`;
}

// ---------------------------------------------------------------- strength overview (#49)

function spark(points) {
  const values = points.map((p) => p.e1rm);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = points[0].workout.date;
  const total = Math.max(1, daysBetween(first, points.at(-1).workout.date));
  const xy = points.map((p) => [2 + (58 * daysBetween(first, p.workout.date)) / total, max === min ? 12 : 20 - (16 * (p.e1rm - min)) / (max - min)]);
  const [lx, ly] = xy.at(-1);
  return `<svg class="spark" width="64" height="24" viewBox="0 0 64 24" fill="none" aria-hidden="true"><polyline points="${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2" fill="var(--accent)"/></svg>`;
}

function strengthScreen() {
  const span = S.strengthSpan;
  const { rows, rated, overall } = strengthOverview(span);
  const words = { '4w': '4 weeks', '12w': '12 weeks', '1y': 'a year' };
  const by = (status) => rows.filter((row) => row.status === status).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  const group = (status, label) => {
    const list = by(status);
    if (list.length === 0) return '';
    return `<h2 class="section-label section-label--gutter group-label">${label} · ${list.length}</h2><ul class="lifts">${list
      .map(
        (row) => `<li><button type="button" class="lifts__row lifts__row--${status}" data-act="exercise" data-id="${row.ex.id}" data-span="${span}">
          <span><span class="lifts__name">${esc(row.ex.name)}</span><span class="lifts__now">${status === 'none' ? plural(row.points.length, 'workout').toUpperCase() : `E1RM ${fmt1(row.latest)} KG`}</span></span>
          ${row.points.length > 1 ? spark(row.points) : '<span></span>'}
          <span class="lifts__change">${status === 'none' ? '<span class="lifts__pct">—</span>' : `<span class="lifts__pct">${signed(row.pct)}%</span><span class="lifts__kg">${signed(row.kg)} kg</span>`}</span></button></li>`,
      )
      .join('')}</ul>`;
  };
  const tally = (status, label) => `<div class="tally__cell tally__cell--${status}"><span class="progress__stat-label">${label}</span><span class="tally__figure">${by(status).length}</span></div>`;
  return `<main class="progress">${appBar({ title: 'Progress', subline: `${rows.length} LIFTS` })}${tabs('progress')}${progressTabs('strength')}
    ${segments([['4w', '4 WEEKS'], ['12w', '12 WEEKS'], ['1y', '1 YEAR']], span, 'strengthSpan', 'segments--three segments--mono')}
    <section class="progress__headline"><div><h2 class="section-label">All lifts · trend over ${words[span]}</h2>
      <p class="progress__e1rm">${overall === null ? '<span class="progress__e1rm-unit">—</span>' : `<span class="progress__e1rm-figure">${signed(overall)}</span> <span class="progress__e1rm-unit">%</span>`}</p></div>
      <p class="progress__change"><span class="progress__change-figure${overall > 2 ? ' progress__change-figure--up' : ''}">${overall === null ? '' : overall >= 2 ? 'STRONGER' : overall <= -2 ? 'WEAKER' : 'HOLDING'}</span><span class="progress__change-span">${rated.length} LIFTS AVERAGED</span></p></section>
    <div class="tally">${tally('gaining', 'Gaining')}${tally('holding', 'Holding')}${tally('losing', 'Losing')}</div>
    ${group('gaining', 'Gaining')}${group('holding', 'Holding')}${group('losing', 'Losing')}${group('none', 'Too few workouts in this span')}
    <footer class="footnote" style="margin-top:22px"><span>Trend of each lift's e1RM across the span</span><span class="footnote__formula">gaining ≥ +2% · losing ≤ −2%</span></footer></main>`;
}

// ---------------------------------------------------------------- muscle balance (#50)

function liveAsWorkout() {
  if (S.live === null) return [];
  return [{ date: TODAY, exercises: S.live.exercises.map((e) => ({ exId: e.exId, sets: e.sets })) }];
}

const SCALE_MAX = 25;
const pos = (sets) => `${Math.min(100, (sets / SCALE_MAX) * 100)}%`;
const STATUS_WORD = { in: 'IN RANGE', low: 'LOW', none: 'NOT TRAINED', high: 'HIGH' };

const SUGGESTIONS = {
  'legs-b': {
    name: 'Legs B',
    slots: [['rdl', 3], ['hipthrust', 3], ['legcurl', 3], ['calf', 4], ['legraise', 3]],
  },
  'push-b': {
    name: 'Push B',
    slots: [['inclinebb', 4], ['dbpress', 3], ['incline', 3], ['lateral', 3], ['pushdown', 3]],
    swaps: { inclinebb: 'Barbell Bench Press' },
  },
};

/** Weeks since a lift's e1RM last went up, and how many workouts that is. */
function stalled(exId) {
  const history = exerciseHistory(exId);
  let best = 0;
  let since = 0;
  history.forEach((p, i) => {
    if (p.e1rm > best + 0.01) {
      best = p.e1rm;
      since = i;
    }
  });
  return { workouts: history.length - 1 - since, weeks: Math.round(weeksAgo(history[since].workout.date)), weight: history.at(-1).top.w };
}

function suggestionCard(id, why, tag, effect) {
  const s = SUGGESTIONS[id];
  const list = s.slots
    .map(([exId, sets]) => {
      const ex = exById[exId];
      const swap = s.swaps?.[exId];
      return `<li><span>${esc(ex.name)}${swap ? ` <span class="suggest__swap">in place of ${esc(swap)}</span>` : ''}</span><span>${sets} × ${range(ex)}</span></li>`;
    })
    .join('');
  const action = S.created[id]
    ? `<div class="suggest__done">${check(15, 'var(--done)')}${esc(s.name)} is in your routines.</div>
       <div class="confirm__actions"><button type="button" class="button button--tertiary" data-act="tab" data-tab="routines">See routines</button><button type="button" class="button button--primary" style="min-height:44px" data-act="start" data-id="${id}">Start now</button></div>`
    : `<button type="button" class="button button--primary" data-act="create" data-id="${id}">Add as a routine</button>`;
  return `<article class="suggest"><p class="suggest__why">${why}</p><div>${tag}</div>
    <div><h3 class="section-label">Suggested routine</h3><div class="suggest__name">${esc(s.name)}</div></div>
    <ul class="suggest__list">${list}</ul>${effect ? `<p class="suggest__effect">${effect}</p>` : ''}${action}</article>`;
}

function balanceScreen() {
  const mode = S.balanceMode;
  const rows = balance(mode, mode === 'week' ? liveAsWorkout() : []);
  const count = (status) => rows.filter((row) => row.status === status).length;
  const list = rows
    .map((row) => {
      const open = S.balanceOpen === row.group;
      const from = Object.entries(row.from).map(([name, n]) => `${esc(name)} ${trim1(n)}`);
      return `<li><button type="button" class="muscles__row muscles__row--${row.status}" data-act="balanceOpen" data-id="${row.group}" aria-expanded="${open}">
        <span class="muscles__top"><span class="muscles__name">${row.group}</span><span class="muscles__value">${trim1(row.total)}<span class="muscles__status">${STATUS_WORD[row.status]}</span></span></span>
        <span class="meter"><span class="meter__band" style="left:${pos(RANGE.low)};right:calc(100% - ${pos(RANGE.high)})"></span><span class="meter__direct" style="width:${pos(row.direct)}"></span><span class="meter__indirect" style="left:${pos(row.direct)};width:calc(${pos(row.total)} - ${pos(row.direct)})"></span></span>
        ${open ? `<span class="muscles__from">${from.length === 0 ? 'No exercise in the last four weeks trains it.' : from.join(' · ')}</span>` : ''}</button></li>`;
    })
    .join('');
  const low = rows.filter((row) => row.status === 'low' || row.status === 'none');
  const base = Object.fromEntries(balance('avg').map((row) => [row.group, row.total]));
  const after = { ...base };
  for (const [exId, sets] of SUGGESTIONS['legs-b'].slots) {
    const ex = exById[exId];
    after[ex.group] += sets;
    for (const g of ex.sec) after[g] += sets / 2;
  }
  const effect = ['hamstrings', 'glutes', 'calves', 'core'].map((g) => `${g.toUpperCase()} ${trim1(base[g])} → ${trim1(after[g])}`).join(' · ');
  const bench = stalled('bench');
  const tally = (label, n, cls) => `<div class="tally__cell ${cls}"><span class="progress__stat-label">${label}</span><span class="tally__figure">${n}</span></div>`;
  return `<main>${appBar({ title: 'Progress', subline: mode === 'avg' ? '13 SEP – 10 OCT' : 'MON 5 OCT – TODAY' })}${tabs('progress')}${progressTabs('balance')}
    <div style="margin:14px var(--gutter) 0">${segments([['avg', '4-week average'], ['week', 'This week']], mode, 'balanceMode')}</div>
    <div class="range-line"><span>Working sets a week, per muscle group. Range:</span>${evidenceTag('10–20 SETS', 'volume')}</div>
    <div class="tally">${tally('In range', count('in') + count('high'), 'tally__cell--gaining')}${tally('Low', count('low'), 'tally__cell--losing')}${tally('Not trained', count('none'), 'tally__cell--losing')}</div>
    <ul class="muscles">${list}</ul>
    <div class="scale" aria-hidden="true"><span style="left:0;transform:none">0</span><span style="left:${pos(10)}">10</span><span style="left:${pos(20)}">20</span></div>
    <div class="legend"><span class="legend__item"><span class="legend__swatch"></span>Sets on the muscle</span><span class="legend__item"><span class="legend__swatch legend__swatch--half"></span>Half sets, trained indirectly</span><span class="legend__item"><span class="legend__swatch legend__swatch--band"></span>10–20 a week</span></div>
    <p class="proto-note">Tap a muscle group to see which exercises its sets came from. ${mode === 'week' ? 'A week in progress always reads low, which is why the four-week average is the default.' : ''}</p>
    <section class="step-two" id="step-two"><span class="step-two__mark">SECOND STEP · NOT IN THE FIRST BUILD</span>
      <p class="step-two__lede">What the balance view and the strength overview would lead to: a suggestion that becomes a routine in one tap.</p></section>
    ${suggestionCard('legs-b', `${low.length} muscle groups are under 10 sets a week: ${low.map((r) => r.group).join(', ')}. One more leg day covers four of them.`, evidenceTag('10–20 SETS', 'volume'), `ONCE A WEEK: ${effect}`)}
    ${suggestionCard('push-b', `Barbell Bench Press has not gained for ${bench.weeks} weeks: ${bench.workouts} workouts at ${fmtW(bench.weight)} kg. A close variation can restart it.`, evidenceTag('VARIATION', 'variation'), 'ALTERNATE PUSH A AND PUSH B FOR SIX WEEKS, THEN COMPARE.')}
    <div style="height:28px"></div></main>`;
}

// ---------------------------------------------------------------- routines and the exercise filter (#41)

function routinesScreen() {
  return `<main>${appBar({ title: 'Routines' })}${tabs('routines')}<ul class="routines">${DB.routines
    .map(
      (routine) => `<li><div class="routines__row"><span class="routines__text"><span class="routines__name">${esc(routine.name)}${S.created[routine.id] ? ' <span class="link-row__done" style="font-size:10px;letter-spacing:.08em">NEW</span>' : ''}</span>
        <span class="routines__meta">${plural(routine.slots.length, 'EXERCISE')} · ${routine.slots.reduce((n, [, t]) => n + t, 0)} SETS</span>
        <span class="routines__preview">${routine.slots.slice(0, 3).map(([id]) => esc(exById[id].name)).join(' · ')}</span></span><span class="routines__go">${chevron()}</span></div></li>`,
    )
    .join('')}</ul><p class="proto-note">The routine list and its editor are unchanged, so they are not clickable here. A routine added from a suggestion lands in this list and can be edited like any other.</p></main>`;
}

function libraryList() {
  const { split, group, q } = S.filter;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const groups = split === 'all' ? GROUPS : SPLITS[split];
  const sections = groups
    .filter((g) => group === 'all' || g === group)
    .map((g) => {
      const list = EXERCISES.filter((ex) => ex.group === g && words.every((w) => ex.name.toLowerCase().includes(w))).sort((a, b) => a.name.localeCompare(b.name));
      if (list.length === 0) return '';
      return `<h3 class="section-label section-label--gutter group-label">${g}</h3><ul class="library__list" style="border-top:1px solid var(--line-hairline)">${list
        .map((ex) => `<li><button type="button" class="library__row" style="width:100%;text-align:left" data-act="exercise" data-id="${ex.id}"><span class="library__name">${esc(ex.name)}</span><span class="library__figure">${ex.inc === 0 ? '—' : `+${fmtW(ex.inc)}`}</span><span class="library__figure">${ex.rest}<span class="library__unit"> s</span></span><span class="library__figure" style="color:var(--text-tertiary)">${chevron()}</span></button></li>`)
        .join('')}</ul>`;
    })
    .join('');
  return sections || '<p class="empty">Nothing matches. Check the spelling, or clear the filter.</p>';
}

function exercisesScreen() {
  const { split, group } = S.filter;
  return `<main class="library">${appBar({ title: 'Exercises' })}${tabs('exercises')}
    <div class="exercise-tools"><div class="field"><div class="field__label-row"><label class="field__label" for="lib-search">Search</label></div><input id="lib-search" type="search" class="field__input" autocomplete="off" data-search value="${esc(S.filter.q)}" placeholder="Name or alias"></div>
      <span class="button button--secondary" style="opacity:.6">New exercise</span></div>
    <div class="filter"><div><div class="field__label" style="margin-bottom:6px">Split</div>${segments([['all', 'All'], ['push', 'Push'], ['pull', 'Pull'], ['legs', 'Legs'], ['core', 'Core']], split, 'split')}</div>
      ${split === 'all' || split === 'core' ? '' : `<div><div class="field__label" style="margin-bottom:6px">Muscle group</div>${segments([['all', 'All'], ...SPLITS[split].map((g) => [g, g])], group, 'group', 'chips').replace('class="segments chips"', 'class="chips"')}</div>`}</div>
    <div id="lib-list">${libraryList()}</div>
    <p class="proto-note">A sample of the 185 seeded exercises. The filter works the same in the routine editor's picker.</p><div style="height:24px"></div></main>`;
}

// ---------------------------------------------------------------- navigation and actions

const SCREENS = {
  today: todayScreen,
  workout: workoutScreen,
  guide: guideScreen,
  history: historyScreen,
  detail: detailScreen,
  exercise: exerciseScreen,
  strength: strengthScreen,
  balance: balanceScreen,
  routines: routinesScreen,
  exercises: exercisesScreen,
};

function render(top = false) {
  const scroller = document.getElementById('phone-scroll');
  scroller.innerHTML = SCREENS[S.screen]() + sheet();
  if (top) scroller.scrollTop = 0;
  renderSide();
}

function go(screen, { push = true } = {}) {
  if (push && S.screen !== screen) S.stack.push({ screen: S.screen, detailId: S.detailId, exId: S.exId, exSpan: S.exSpan });
  S.screen = screen;
  S.edit = null;
  S.flash = '';
  render(true);
}

function root(screen) {
  S.stack = [];
  go(screen, { push: false });
}

const parse = (text) => {
  const trimmed = String(text).trim().replace(',', '.');
  return trimmed === '' ? null : Number(trimmed);
};

function findSet(setId) {
  if (S.edit?.scope === 'live') {
    const entry = S.live.exercises.find((e) => e.sets.some((s) => s.id === setId));
    return { owner: entry, list: entry.sets };
  }
  const workout = DB.workouts.find((w) => w.id === S.detailId);
  const entry = workout.exercises.find((e) => e.sets.some((s) => s.id === setId));
  return { workout, owner: entry, list: entry.sets };
}

function openEdit(scope, setId) {
  if (S.edit?.setId === setId) {
    S.edit = null;
  } else {
    S.edit = { scope, setId };
    const set = findSet(setId).list.find((s) => s.id === setId);
    Object.assign(S.edit, { w: fmtW(set.w), r: String(set.r), rir: set.rir === null ? '' : String(set.rir), confirm: false, error: '' });
  }
  S.flash = '';
  render();
}

const ACT = {
  noop() {},
  back() {
    const prev = S.stack.pop();
    if (prev === undefined) return root('today');
    Object.assign(S, prev);
    S.edit = null;
    S.flash = '';
    render(true);
  },
  tab({ tab }) {
    root(tab === 'progress' ? S.progTab : tab);
  },
  progTab({ id }) {
    S.progTab = id;
    root(id);
  },
  go({ id }) {
    go(id);
  },
  start({ id }) {
    const routine = DB.routines.find((r) => r.id === id);
    if (S.live === null || S.live.routineId !== id) startWorkout(routine);
    S.full = false;
    go('workout');
  },
  openExercise({ id }) {
    S.live.cur = Number(id);
    S.edit = null;
    openDraft();
    render(true);
  },
  warm() {
    S.live.warm = !S.live.warm;
    render();
  },
  rir() {
    S.rirOpen = !S.rirOpen;
    render();
  },
  complete() {
    const live = S.live;
    const entry = liveEntry();
    const ex = exById[entry.exId];
    const w = parse(live.draft.w);
    const r = parse(live.draft.r) ?? ex.lo;
    const rir = parse(live.draft.rir);
    if (w === null || Number.isNaN(w) || w < 0) live.refusal = 'Enter the weight, in digits only';
    else if (!Number.isInteger(r) || r < 1 || r > 100) live.refusal = 'Reps are a whole number from 1 to 100';
    else if (rir !== null && (!Number.isInteger(rir) || rir < 0 || rir > 10)) live.refusal = 'RIR is a whole number from 0 to 10, or empty';
    else live.refusal = '';
    if (live.refusal) return render();
    entry.sets.push({ id: `L${(live.seq += 1)}`, w, r, rir, warm: live.warm });
    live.rest = { start: Date.now(), total: ex.rest, extra: 0, dismissed: false };
    // The set that reaches the target moves on to the next exercise with sets left (docs/10 §1).
    if (!live.warm && working(entry.sets).length === entry.target) {
      const next = live.exercises.findIndex((e) => e !== entry && !isComplete(e));
      if (next >= 0) live.cur = next;
    }
    openDraft();
    render(S.full);
  },
  extend() {
    S.live.rest.extra += 30;
    render();
  },
  skip() {
    S.live.rest.dismissed = true;
    render();
  },
  restJump() {
    const rest = S.live?.rest;
    if (!rest || rest.dismissed) return;
    rest.start = Date.now() - (rest.total + rest.extra - 5) * 1000;
    render();
  },
  full() {
    S.full = true;
    render(true);
  },
  fullExit() {
    S.full = false;
    render(true);
  },
  focusStep({ id }) {
    S.focusSteps[id] = !S.focusSteps[id];
    render();
  },
  focusDone() {
    S.focusDone = true;
    ACT.back();
  },
  finishAsk() {
    S.live.finishing = true;
    render();
  },
  finishKeep() {
    S.live.finishing = false;
    render();
  },
  finish() {
    const live = S.live;
    const exercises = live.exercises.filter((e) => e.sets.length > 0).map((e) => ({ exId: e.exId, target: e.target, sets: e.sets }));
    S.live = null;
    S.full = false;
    if (exercises.length === 0) return root('today');
    const minutes = Math.max(1, Math.round((Date.now() - live.startedAt) / 60000));
    const id = `wlive${Date.now()}`;
    DB.workouts.push({ id, date: TODAY, start: '18:32', minutes, routineId: live.routineId, name: live.name, exercises });
    S.stack = [{ screen: 'history', detailId: null, exId: S.exId, exSpan: S.exSpan }];
    S.detailId = id;
    S.screen = 'detail';
    S.edit = null;
    S.flash = 'Workout finished. It is in History from now on.';
    render(true);
  },
  detail({ id }) {
    S.detailId = id;
    if (S.screen === 'detail') return render(true);
    go('detail');
  },
  exercise({ id, span }) {
    S.exId = id;
    if (span !== undefined) S.exSpan = span;
    go('exercise');
  },
  exSpan({ id }) {
    S.exSpan = id;
    render();
  },
  strengthSpan({ id }) {
    S.strengthSpan = id;
    render();
  },
  balanceMode({ id }) {
    S.balanceMode = id;
    render();
  },
  balanceOpen({ id }) {
    S.balanceOpen = S.balanceOpen === id ? null : id;
    render();
  },
  earlier() {
    S.histCount += 20;
    render();
  },
  sheet({ id }) {
    S.sheet = id;
    render();
  },
  sheetClose(_, el, event) {
    if (event.target.closest('.sheet') !== null && event.target.closest('.sheet__close') === null) return;
    S.sheet = null;
    render();
  },
  create({ id }) {
    const s = SUGGESTIONS[id];
    if (!S.created[id]) DB.routines.push({ id, name: s.name, slots: s.slots });
    S.created[id] = true;
    render();
  },
  split({ id }) {
    S.filter.split = id;
    S.filter.group = 'all';
    render();
  },
  group({ id }) {
    S.filter.group = id;
    render();
  },
  editLive({ id }) {
    openEdit('live', id);
  },
  editHist({ id }) {
    openEdit('hist', id);
  },
  editCancel() {
    S.edit = null;
    render();
  },
  editAskDelete() {
    S.edit.confirm = true;
    render();
  },
  editKeep() {
    S.edit.confirm = false;
    render();
  },
  editSave() {
    const e = S.edit;
    const w = parse(e.w);
    const r = parse(e.r);
    const rir = parse(e.rir);
    if (w === null || Number.isNaN(w) || w < 0 || w > 9999.99) e.error = 'Weight is 0 to 9999.99 kg';
    else if (r === null || !Number.isInteger(r) || r < 1 || r > 100) e.error = 'Reps are a whole number from 1 to 100';
    else if (rir !== null && (!Number.isInteger(rir) || rir < 0 || rir > 10)) e.error = 'RIR is a whole number from 0 to 10, or empty';
    else e.error = '';
    if (e.error) return render();
    const set = findSet(e.setId).list.find((s) => s.id === e.setId);
    Object.assign(set, { w, r, rir });
    S.flash = e.scope === 'hist' ? 'Set saved. Charts, last time and the target use the new figures.' : '';
    S.edit = null;
    if (S.live !== null && e.scope === 'live') openDraft();
    render();
  },
  editDelete() {
    const e = S.edit;
    const found = findSet(e.setId);
    found.list.splice(found.list.findIndex((s) => s.id === e.setId), 1);
    S.edit = null;
    if (e.scope === 'live') {
      openDraft();
      return render();
    }
    const { workout } = found;
    if (found.list.length === 0) workout.exercises.splice(workout.exercises.indexOf(found.owner), 1);
    if (workout.exercises.length === 0) {
      DB.workouts.splice(DB.workouts.indexOf(workout), 1);
      S.stack = [];
      S.screen = 'history';
      S.flash = 'That was its last set, so the workout was removed.';
      return render(true);
    }
    S.flash = 'Set deleted. Charts, last time and the target no longer count it.';
    render();
  },
};

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-act]');
  if (el === null) return;
  const action = ACT[el.dataset.act] ?? JUMP[el.dataset.act];
  if (action === undefined) return;
  event.preventDefault();
  action(el.dataset, el, event);
});

document.addEventListener('input', (event) => {
  const el = event.target;
  if (el.dataset.draft !== undefined && S.live !== null) {
    S.live.draft[el.dataset.draft] = el.value;
    el.parentElement.style.setProperty('--chars', Math.max(1, (el.value || el.dataset.placeholder).length));
  }
  if (el.dataset.edit !== undefined && S.edit !== null) S.edit[el.dataset.edit] = el.value;
  if (el.dataset.search !== undefined) {
    S.filter.q = el.value;
    document.getElementById('lib-list').innerHTML = libraryList();
  }
});

// The clocks: the elapsed time and the rest countdown tick without redrawing the screen under a finger.
let wasOver = false;
setInterval(() => {
  if (S.live === null || S.screen !== 'workout') return;
  for (const el of document.querySelectorAll('[data-elapsed]')) el.textContent = clock((Date.now() - S.live.startedAt) / 1000);
  const rest = restState();
  const over = rest?.over ?? false;
  if (over !== wasOver) {
    wasOver = over;
    if (document.activeElement?.tagName !== 'INPUT') render();
    return;
  }
  if (rest === null) return;
  for (const el of document.querySelectorAll('[data-rest]')) el.textContent = rest.over ? `+${clock(-rest.remaining)}` : clock(Math.ceil(rest.remaining));
  for (const el of document.querySelectorAll('[data-rest-fill]')) el.style.width = `${rest.over ? 100 : Math.min(100, (rest.elapsed / rest.total) * 100)}%`;
}, 500);
