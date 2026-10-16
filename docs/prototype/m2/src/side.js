// The page round the phone: the controls, the screen map by slice issue, the note for the screen on
// show, the open questions, and the M1 look-and-feel notes.

function freshToday(clock, extra = {}) {
  S.clock = clock;
  S.days = {};
  S.open = null;
  S.eodLeft = {};
  S.offline = false;
  S.shortfall = false;
  S.generating = false;
  S.setup = { profile: true, foods: true, phase: true, routine: true };
  Object.assign(S, extra);
  root('today');
}

const MAP = [
  {
    group: 'Navigation (Q7)',
    items: [
      { id: 'tabs5', issue: '#75 · Q7', name: 'Five tabs', on: () => false, jump: () => setTabs('five') },
      { id: 'tabs4', issue: '#75 · Q7', name: 'Four tabs: Routines and Exercises as one', on: () => S.screen === 'training', jump: () => (setTabs('four'), root('training')) },
    ],
  },
  {
    group: 'Today, the whole day (screen 3)',
    items: [
      { id: 'today', issue: '#79 #80', name: 'Today, a training day', on: () => S.screen === 'today' && S.clock === 'midday' && !S.offline && !S.shortfall && setupStep() === null && !S.generating, jump: () => freshToday('midday') },
      { id: 'rest', issue: '#79', name: 'Today, a rest day', on: () => S.screen === 'today' && S.clock === 'morning' && setupStep() === null, jump: () => freshToday('morning', { eodLeft: { [TODAY]: true } }) },
      { id: 'evening', issue: '#80', name: 'Evening: the end-of-day card', on: () => S.screen === 'today' && S.clock === 'evening', jump: () => freshToday('evening') },
      { id: 'adjust', issue: '#80', name: 'Adjust a meal', on: () => S.screen === 'adjust', jump: () => (freshToday('midday'), ACT.adjustOpen({ id: 'm2' })) },
      { id: 'replace', issue: '#80', name: 'Replace a meal', on: () => S.screen === 'replace', jump: () => (freshToday('midday'), ACT.replaceOpen({ id: 'm2' })) },
      { id: 'setup', issue: '#79', name: 'First run: the plan’s four steps', on: () => S.screen === 'today' && setupStep() !== null, jump: () => freshToday('midday', { setup: { profile: false, foods: false, phase: false, routine: false } }) },
      { id: 'shortfall', issue: '#79', name: 'Protein short: the shortfall named', on: () => S.screen === 'today' && S.shortfall, jump: () => freshToday('midday', { shortfall: true }) },
      { id: 'offline', issue: '#80', name: 'Offline: the cached plan', on: () => S.screen === 'today' && S.offline, jump: () => freshToday('midday', { offline: true }) },
    ],
  },
  {
    group: 'End-of-day check (screen 4)',
    items: [
      { id: 'eod', issue: '#80', name: 'End of day, from the evening card', on: () => S.screen === 'eod' && S.clock === 'evening', jump: () => (freshToday('evening'), ACT.eodOpen({ id: TODAY })) },
      { id: 'eodY', issue: '#80', name: 'Yesterday, next morning', on: () => S.screen === 'eod' && S.clock === 'morning', jump: () => (freshToday('morning'), ACT.eodOpen({ id: TODAY })) },
    ],
  },
  {
    group: 'Food tab: prep and grocery (screen 5)',
    items: [
      { id: 'prep', issue: '#81', name: 'Prep plan, two cook days', on: () => S.screen === 'prep', jump: () => ACT.foodTab({ id: 'prep' }) },
      { id: 'grocery', issue: '#81', name: 'Grocery list', on: () => S.screen === 'grocery', jump: () => ACT.foodTab({ id: 'grocery' }) },
      { id: 'batches', issue: '#81', name: 'Batches', on: () => S.screen === 'batches', jump: () => ACT.foodTab({ id: 'batches' }) },
      { id: 'batch', issue: '#81', name: 'Record a batch, keeps for N days', on: () => S.screen === 'batch', jump: () => (ACT.foodTab({ id: 'batches' }), ACT.batchOpen({ id: 'chicken' })) },
    ],
  },
  {
    group: 'Food tab: the food list',
    items: [
      { id: 'foods', issue: '#78', name: 'Your foods, with search', on: () => S.screen === 'foods' && !S.emptyFoods, jump: () => ((S.emptyFoods = false), ACT.foodTab({ id: 'foods' })) },
      { id: 'foodsEmpty', issue: '#78', name: 'No foods yet', on: () => S.screen === 'foods' && S.emptyFoods, jump: () => ((S.emptyFoods = true), ACT.foodTab({ id: 'foods' })) },
      { id: 'food', issue: '#78 #81', name: 'One food', on: () => S.screen === 'food', jump: () => (ACT.foodTab({ id: 'foods' }), ACT.foodOpen({ id: 'chicken' })) },
      { id: 'add', issue: '#78', name: 'Add a food: search', on: () => S.screen === 'add', jump: () => (ACT.foodTab({ id: 'foods' }), (S.addQ = 'chicken'), go('add')) },
      { id: 'barcode', issue: '#78', name: 'Barcode', on: () => S.screen === 'barcode', jump: () => (ACT.foodTab({ id: 'foods' }), (S.scanned = false), go('barcode')) },
      { id: 'label', issue: '#78', name: 'Label photo read', on: () => S.screen === 'label', jump: () => (ACT.foodTab({ id: 'foods' }), ACT.labelOpen()) },
      { id: 'confirm', issue: '#78', name: 'Check before saving (label read)', on: () => S.screen === 'confirm' && !S.candidate?.manual, jump: () => (ACT.foodTab({ id: 'foods' }), (S.candidate = newCandidate('label')), go('confirm')) },
      { id: 'manual', issue: '#78', name: 'Enter by hand', on: () => S.screen === 'confirm' && S.candidate?.manual, jump: () => (ACT.foodTab({ id: 'foods' }), ACT.manualOpen()) },
      { id: 'groups', issue: '#78', name: 'Rotation groups', on: () => S.screen === 'groups', jump: () => (ACT.foodTab({ id: 'foods' }), go('groups')) },
    ],
  },
  {
    group: 'Plan setup',
    items: [
      { id: 'phase', issue: '#79', name: 'Goal phase and targets', on: () => S.screen === 'phase', jump: () => (root('today'), ACT.phaseOpen()) },
      { id: 'routine', issue: '#79', name: 'Your day and meal count', on: () => S.screen === 'routine', jump: () => (root('today'), ACT.routineOpen()) },
      { id: 'profile', issue: '#79', name: 'About you (step 1)', on: () => S.screen === 'profile', jump: () => (root('today'), go('profile')) },
    ],
  },
  {
    group: 'Progress: weight (screen 6)',
    items: [
      { id: 'weight', issue: '#76 #82', name: 'Weight and the maintenance check', on: () => S.screen === 'weight' && S.weightData === 'full' && S.maint === 'ready', jump: () => setWeight('full', 'ready') },
      { id: 'low', issue: '#82', name: 'Too little recent logging', on: () => S.screen === 'weight' && S.maint === 'low', jump: () => setWeight('full', 'low') },
      { id: 'collecting', issue: '#82', name: 'Under 14 complete days', on: () => S.screen === 'weight' && S.maint === 'collecting', jump: () => setWeight('full', 'collecting') },
      { id: 'weighin', issue: '#82', name: 'Too few weigh-ins', on: () => S.screen === 'weight' && S.maint === 'weighin', jump: () => setWeight('full', 'weighin') },
      { id: 'few', issue: '#76', name: 'Two days of weight: no trend yet', on: () => S.screen === 'weight' && S.weightData === 'few', jump: () => setWeight('few', 'collecting') },
      { id: 'noweight', issue: '#76', name: 'No weigh-ins', on: () => S.screen === 'weight' && S.weightData === 'none', jump: () => setWeight('none', 'collecting') },
      { id: 'weigh', issue: '#76', name: 'Type a weight', on: () => S.screen === 'weigh', jump: () => (setWeight('full', 'ready'), ACT.weighOpen()) },
      { id: 'route', issue: '#77', name: 'Weight from the scale: setup', on: () => S.screen === 'route', jump: () => (setWeight('full', 'ready'), go('route')) },
    ],
  },
];
const ALL = MAP.flatMap((g) => g.items);

function setTabs(variant) {
  S.tabs = variant;
  document.getElementById('phone-scroll').scrollTop = 0;
  if (variant === 'five' && S.screen === 'training') return root('routines');
  if (variant === 'four' && (S.screen === 'routines' || S.screen === 'exercises')) return root('training');
  render();
}
function setWeight(data, maint) {
  S.applied = null;
  S.weightData = data;
  S.maint = maint;
  S.progTab = 'weight';
  root('weight');
}

const NOTES = {
  tabs5: {
    title: 'Five tabs (Q7)',
    points: [
      'Today, <strong>Food</strong>, Progress, Routines, Exercises. Food is new; the other four are M1’s.',
      'At 390pt the five labels share 358pt. Look at whether <strong>EXERCISES</strong> still reads at the app’s 11px.',
      'Switch with <strong>Tab bar</strong> above the map to compare on any screen.',
    ],
    tryIt: 'Tap each tab. Then switch the tab bar to four and tap Training.',
  },
  tabs4: {
    title: 'Four tabs: Routines and Exercises as one (Q7)',
    points: [
      'Routines and Exercises become two sections of one tab, as Progress holds its sections.',
      'The tab is called <strong>Training</strong> here; its name is Q2.',
      'Nothing inside either section changes.',
    ],
    tryIt: 'Switch between Routines and Exercises inside the tab, then go back to five tabs.',
  },
  today: {
    title: 'Today becomes the whole day (Q7, screen 3 redrawn)',
    points: [
      'The day’s meals in time order with the <strong>workout in its place</strong> at 18:30, started from there. Other routines stay one tap away under the day.',
      'Redrawn for reading: totals in words (<em>2,331 of 2,350 kcal planned</em>), each macro says <em>on target</em>, <em>12 g over</em> or <em>to go</em>, meals list foods as rows at 13px, and the actions are words.',
      'The day totals stay stuck under the app bar while the day scrolls (§7.3).',
      'Every meal can be opened and confirmed, not just the next one due. A confirmed meal can be changed; the change replaces it.',
    ],
    tryIt: 'Tap <strong>Eaten as planned</strong> on Lunch, then open Before training and tap its <strong>MORE CARBS</strong> tag. Scroll and watch the totals.',
  },
  rest: {
    title: 'Today on a rest day',
    points: ['Saturday: four meals and no workout in the day. Starting a workout is still one tap, under the day.', 'Next morning on the prototype’s clock, with yesterday already settled.'],
    tryIt: 'Use <strong>Clock</strong> above to move through the day.',
  },
  evening: {
    title: 'Evening: the end-of-day card (F11)',
    points: ['From an hour before bedtime, a card at the top of Today counts the meals not confirmed yet and opens the end-of-day check.', 'It shows only when at least one meal is unconfirmed.'],
    tryIt: 'Open the card. Or confirm both meals on Today and watch it go.',
  },
  adjust: {
    title: 'Adjust a meal (S18)',
    points: ['Grams change in 5 g steps, pieces in whole pieces. A food in a rotation group can be swapped for another in it.', 'The meal’s total before and after is shown before saving.', 'Below 0 g is refused in place, and the meal stays as planned (F11, a 422 on adjust).'],
    tryIt: 'Swap rice for potato, take 5 g off broccoli, then try taking chicken to 0.',
  },
  replace: {
    title: 'Replace a meal (S18)',
    points: ['From your foods, or by hand with your own numbers.', 'A photo or a short description is M3 (S22), so it is not drawn here.'],
    tryIt: 'Add salmon twice, then switch to By hand.',
  },
  setup: {
    title: 'First run: the four steps (F10)',
    points: ['Today shows the first missing step as its empty state, in F10’s order: about you, foods, goal phase, your day.', 'Each step saves on its own; leaving partway resumes at the first missing one.', 'Starting a workout works before any of it.'],
    tryIt: 'Walk the four steps. After the last, the plan is made while you watch.',
  },
  shortfall: {
    title: 'The food list can’t reach protein (Edge cases)',
    points: ['The plan is the closest one and names what it missed, in grams. Nothing else is padded to hide it.', 'It offers to add a protein source.'],
    tryIt: 'Read the macro meter for protein: it says how far short.',
  },
  offline: {
    title: 'Offline on Today (F11)',
    points: ['The cached plan with its age in the data-state slot.', 'Confirming needs a connection, and the buttons say so. Only sets queue offline (06).'],
    tryIt: 'Open a meal and read its buttons.',
  },
  eod: {
    title: 'End-of-day check (screen 4 redrawn)',
    points: [
      'The count, then one plain sentence of what leaving them means.',
      'Each meal has the same four answers as on Today, all secondary: the screen’s one primary is <strong>Confirm all as planned</strong>.',
      '<strong>If you confirm them all</strong> previews the day and the complete-day counter before anything is written.',
      'The two actions are pinned to the foot while the list scrolls behind them (§7.3).',
    ],
    tryIt: 'Confirm one meal alone, then confirm the rest at once. Or leave the day incomplete.',
  },
  eodY: {
    title: 'Yesterday, the next morning (F11)',
    points: ['If the evening check was missed, the next morning’s Today carries a Yesterday card. Leaving the day incomplete asks once and never again.'],
    tryIt: 'Leave the day incomplete, then look at Today.',
  },
  prep: {
    title: 'Prep plan with a second cook day (screen 5 redrawn, Q8)',
    points: [
      'Grouped by cook day: Sunday for Monday to Wednesday, Thursday for Thursday to Sunday, because chicken keeps 4 days.',
      'Each row says in words where its cooked figure comes from: its batch’s yield, a batch over a week old (<em>weigh this week’s batch</em>), or no batch (<em>approximate</em>).',
      'Raw is the figure to shop and cook by, at 17px; cooked is smaller.',
      'Each cook day’s heading sticks while its rows scroll (§7.3).',
      'Ticking a row opens <strong>Record a batch</strong> with the raw grams filled in.',
    ],
    tryIt: 'Tick Chicken breast on Sunday, type a cooked weight, save.',
  },
  grocery: {
    title: 'The grocery list (S17)',
    points: ['The prep plan summed per food, raw weight. Chicken reads 3,250 g: 1,400 + 1,850 for two cooks.', 'Eggs and bananas in pieces.', 'Each row is a 60pt tick target, made to be used in a shop. Ticks stay on the phone.'],
    tryIt: 'Tick a few items and read the count.',
  },
  batches: {
    title: 'Batches (S13)',
    points: ['Every batch by food, newest first. The newest is the one in use.', 'A food not weighed for over a week says so.'],
    tryIt: 'Record a batch from here.',
  },
  batch: {
    title: 'Record a batch, and keeps for N days (S13, Q8)',
    points: ['Raw in, cooked out, the day it was cooked. The yield appears as you type, with what it means for a portion.', '<strong>Keeps for</strong> belongs to the food and applies to every batch of it: it is what makes the planner add a second cook day.', 'Both weights must be above 0 g; a cooked weight above raw is accepted (rice).'],
    tryIt: 'Type 1,400 raw and 1,050 cooked. Then try a cooked weight of 0.',
  },
  foods: {
    title: 'Your foods (S12)',
    points: ['One flat list by name, with each food’s group, batch-cooking and pieces as tags.', 'Values per 100 g of the state named, raw or cooked.', 'Search filters as you type; no match offers to add it.'],
    tryIt: 'Search “oat”, then “xyz”. Open Chicken breast.',
  },
  foodsEmpty: {
    title: 'No foods yet (Empty states)',
    points: ['The plan can’t be built. The prompt asks for a protein source first.'],
    tryIt: 'Tap Add a food.',
  },
  food: {
    title: 'One food',
    points: ['Its values, where they came from, and how the plan uses it: pieces, rotation group, batch-cooking.', 'A batch-cooked food lists its batches. Archive keeps it in past plans.'],
    tryIt: 'Record a batch from here.',
  },
  add: {
    title: 'Add a food: search first (F9)',
    points: ['F9’s order: the MEXT table, then a barcode, then a label photo, then by hand.', 'MEXT rows show the English name, the Japanese name as MEXT prints it, and the code.', 'A food already on the list says so on the next screen instead of making a second.'],
    tryIt: 'Pick “Chicken breast, skinless, raw” (already on the list), then go back and pick a grilled one.',
  },
  barcode: {
    title: 'Barcode (F9)',
    points: ['Found: straight to the check screen. Not found: label photo or by hand. Already on the list: opens it. Service down: a way forward, not an error.'],
    tryIt: 'Choose each outcome under the viewfinder and scan.',
  },
  label: {
    title: 'Label photo read (F9)',
    points: ['One photo of the 栄養成分表示. The read becomes a candidate, never a saved food.', 'Unreadable, the daily cap, and the reader down each have their way forward.'],
    tryIt: 'Take the photo with Read chosen. Then try Service down.',
  },
  confirm: {
    title: 'Check before saving (F9 step 5)',
    points: [
      '<strong>As printed</strong> shows the label’s own basis, per pot of 113 g. Under it, the per-100 g values that will be saved, already converted and editable.',
      'Fiber was not on the label, so it is empty and says so. Nothing is guessed.',
      'Pieces, keeps-for and the rotation group are optional here and can be set later.',
    ],
    tryIt: 'Correct a value and save. The food lands on your list.',
  },
  manual: {
    title: 'Enter by hand (F9 step 4)',
    points: ['The same check screen, empty. The packet’s basis can be per piece, serving or package; the app converts to per 100 g.'],
    tryIt: 'Choose Per serving and type its weight.',
  },
  groups: {
    title: 'Rotation groups (S12)',
    points: ['Foods that stand in for each other. The planner varies the week within a group, and Adjust offers them as swaps.'],
    tryIt: 'Read the three groups.',
  },
  phase: {
    title: 'Goal phase and targets (S14)',
    points: [
      'Each default says it is one, with what it means for you in grams and kilos, and its source as an evidence tag.',
      'Calories carry <strong>Provisional</strong> until the maintenance check is applied.',
      'Switching phase type while a cut is open says the cut ends today and is kept.',
    ],
    tryIt: 'Change protein to 2.0 and leave the field. Switch to Bulk.',
  },
  routine: {
    title: 'Your day and meal count (S15)',
    points: ['Training days and rest days each have their own day. The recommendation gives the count and the times, and says why.', 'It says plainly that meal count does not change fat loss.', 'The count can be changed; the recommendation then says what it was.'],
    tryIt: 'Change the count to 3, then to 6. Switch to Rest day.',
  },
  profile: {
    title: 'About you (F10 step 0)',
    points: ['Asked first, because the defaults need weight and height. Weight comes from a weigh-in when there is one.'],
    tryIt: 'Save.',
  },
  weight: {
    title: 'Weight in Progress, and the maintenance check (screen 6 redrawn)',
    points: [
      'Weight is the fourth section of Progress (Q7). The trend at 42px, and the week’s change said in words.',
      'Daily weigh-ins as dots, a late reading as a ring, the trend line over them.',
      'The maintenance check reads as a sentence: what you ate, how the trend moved, so maintenance is about this. Read-only until applied, and applying asks once.',
      'Typing a weight sits next to the scale, always (06, Q4).',
      'The phase line is a normal row at the end, not pinned (§7.3).',
    ],
    tryIt: 'Tap <strong>Apply to targets</strong>. Switch the span. Open the scale’s setup.',
  },
  low: { title: 'Too little recent logging (S18a)', points: ['One line in flag colour above the caveat. Apply stays available.'], tryIt: 'Compare with the full card.' },
  collecting: { title: 'Under 14 complete days (S18a)', points: ['A count towards the gate and what a complete day is. No figures, no action.'], tryIt: 'Compare with the full card.' },
  weighin: { title: 'Too few weigh-ins (03 §8.3)', points: ['“Weigh in to see this”, with what it needs and a way to type one.'], tryIt: 'Tap Type a weight.' },
  few: { title: 'Two days of weight (Empty states)', points: ['Raw points only, no trend line. The headline is the latest weigh-in and says when the trend starts.'], tryIt: 'Compare with the full chart.' },
  noweight: { title: 'No weigh-ins (Empty states)', points: ['Two ways in: type one, or set up the scale.'], tryIt: 'Tap Set up the scale.' },
  weigh: {
    title: 'Type a weight (S11)',
    points: ['Date and time start at now and can be changed, so a reading typed later can still be the morning’s.', 'The line under them says how the time counts.', 'Out of range is refused in place.'],
    tryIt: 'Change the time to 11:30 and read the line. Save with no weight.',
  },
  route: {
    title: 'Weight from the scale (S11, #77)',
    points: [
      'Both candidate routes are drawn; the hardware tests pick one (06, 2026-09-19). This is not a review question.',
      'Google Health: link Fitbit in EufyLife, connect Google once.',
      'Health Auto Export: a token shown once, the automation’s settings, and the unlock rule said plainly.',
      'The top says when weight last arrived, or that it never has.',
    ],
    tryIt: 'Make a token. Switch routes. Set the sync state to Arrived.',
  },
};
const FALLBACK = { title: 'Unchanged from M1', points: ['This screen is M1’s and is here only so every tab can be reached.'], tryIt: 'Go back to an M2 screen from the map.' };

const SIDE_ACT = {
  jump: ({ id }) => ALL.find((m) => m.id === id).jump(),
  theme({ id }) {
    document.documentElement.dataset.theme = id;
    renderSide();
  },
  tabsVariant: ({ id }) => setTabs(id),
  clock({ id }) {
    freshToday(id);
  },
};

function current() {
  return ALL.find((m) => m.on()) ?? null;
}

function controls() {
  const theme = document.documentElement.dataset.theme ?? 'dark';
  const seg = (items, value, act) => `<div class="ctl__seg" role="group">${items.map(([id, label]) => `<button type="button" class="ctl__btn" data-act="${act}" data-id="${id}" aria-pressed="${id === value}">${label}</button>`).join('')}</div>`;
  return `<div class="ctl"><span class="ctl__label">Theme</span>${seg([['dark', 'Dark'], ['light', 'Light']], theme, 'theme')}</div>
    <div class="ctl"><span class="ctl__label">Tab bar</span>${seg([['five', 'Five tabs'], ['four', 'Four tabs']], S.tabs, 'tabsVariant')}</div>
    <div class="ctl"><span class="ctl__label">Clock</span>${seg([['midday', 'Fri 12:10'], ['evening', 'Fri 22:05'], ['morning', 'Sat 07:40']], S.clock, 'clock')}</div>`;
}

function renderSide() {
  const cur = current();
  const tabNote = S.screen === 'routines' || S.screen === 'exercises' ? NOTES.tabs5 : null;
  document.getElementById('phone-caption').textContent = cur ? `${cur.issue} · ${cur.name}` : tabNote ? '#75 · Five tabs' : 'M1, unchanged';
  document.getElementById('controls').innerHTML = controls();
  document.getElementById('map').innerHTML = MAP.map(
    (g) => `<div class="map-group"><h3 class="map-group__title">${g.group}</h3><div class="screen-map">${g.items
      .map((m) => `<button type="button" class="screen-map__item" data-act="jump" data-id="${m.id}" aria-current="${m === cur || (m.id === 'tabs5' && tabNote !== null)}"><span class="screen-map__issue">${m.issue}</span><span class="screen-map__name">${m.name}</span></button>`)
      .join('')}</div></div>`,
  ).join('');
  const note = cur ? NOTES[cur.id] : (tabNote ?? FALLBACK);
  const qs = QUESTIONS.filter((q) => q.screens.includes(cur?.id ?? (tabNote ? 'tabs5' : '')));
  document.getElementById('now').innerHTML = `<span class="now__label">On the phone now</span><h3>${note.title}</h3>
    <ul>${note.points.map((p) => `<li>${p}</li>`).join('')}</ul>
    ${qs.length ? `<p class="now__qs">Questions on this screen: ${qs.map((q) => `<a href="#q-${q.key}">${q.key}</a>`).join(', ')}</p>` : ''}
    <p class="now__try"><strong>Try:</strong> ${note.tryIt}</p>`;
}

const QUESTIONS = [
  {
    key: 'Q1',
    issue: '#75 nav',
    screens: ['tabs5', 'tabs4'],
    title: 'Five tabs, or Routines and Exercises merged into one',
    drawn: 'Both are drawn; use <strong>Tab bar</strong> above to switch on any screen. Five: Today, Food, Progress, Routines, Exercises. Four: Today, Food, Progress, Training. At 390pt the five labels are tight at the app’s 11px (look at EXERCISES).',
    options: ['Five tabs', 'Four tabs, Routines and Exercises merged'],
    open: true,
  },
  {
    key: 'Q2',
    issue: '#75 nav',
    screens: ['tabs4'],
    title: 'If merged, what the tab is called',
    drawn: '<strong>Training</strong>, with Routines and Exercises as its two sections.',
    options: ['Workouts', 'Lifts', 'Gym'],
  },
  {
    key: 'Q3',
    issue: '#75 #78 #81',
    screens: ['prep', 'grocery', 'foods', 'batches'],
    title: 'The Food tab’s sections, and which one it opens on',
    drawn: 'Four sections, Prep, Grocery, Foods, Batches, opening on Prep.',
    options: ['Open on Foods', 'Three sections: Batches inside each food and the prep plan, not its own'],
  },
  {
    key: 'Q4',
    issue: '#76',
    screens: ['weight'],
    title: 'Where Weight sits in Progress',
    drawn: 'The fourth section, after History, Strength and Balance.',
    options: ['The first section, so Progress opens on it', 'Also a one-line weight row on Today'],
  },
  {
    key: 'Q5',
    issue: '#79',
    screens: ['today', 'rest'],
    title: 'Starting a workout from Today',
    drawn: 'The day’s routine has its <strong>Start</strong> in its place in the timeline, at the training time. Other routines are listed under the day. On a rest day, only the list.',
    options: ['A Start section above the day, as M1’s Today has it'],
  },
  {
    key: 'Q6',
    issue: '#80',
    screens: ['today'],
    title: 'Which meals can be confirmed from Today',
    drawn: 'Any meal: the next one due is open, and tapping any other opens it with the same actions. Screen 3 had only the next one actionable.',
    options: ['Only the next meal due; the others are read-only until it is confirmed'],
  },
  {
    key: 'Q7',
    issue: '#80',
    screens: ['today', 'eod'],
    title: 'Skipped as its own action',
    drawn: 'Four actions on a meal: <strong>Eaten as planned</strong>, Adjust, Replaced, Skipped. A skipped meal counts nothing and still makes the day complete.',
    options: ['Three actions, with Skipped inside Replaced as “nothing”'],
  },
  {
    key: 'Q8',
    issue: '#79',
    screens: ['today', 'shortfall'],
    title: 'How the macro meters read',
    drawn: 'In words: <em>Protein 183 / 181</em>, then <em>on target</em>, <em>23 g over</em> or <em>12 g to go</em>, in grey. Over target is not coloured.',
    options: ['Colour an over-target macro in flag', 'Figures only, as the artboard drew them'],
  },
  {
    key: 'Q9',
    issue: '§7.3 all screens',
    screens: ['today', 'eod', 'prep', 'weight'],
    title: 'What sticks while a screen scrolls, and how a stuck block looks',
    drawn: 'The app bar sticks on every screen, as on the workout screen. Below it: Today’s day totals; each prep cook day’s heading while its rows pass; the end-of-day check’s two actions pinned at the foot. Weight’s phase line becomes a normal row. A stuck block looks like screen 1’s bar: the ground colour, its hairline, no shadow.',
    options: ['Stuck blocks on the raised surface with the heavier border', 'Only the app bar sticks; Today’s totals scroll away'],
  },
  {
    key: 'Q10',
    issue: '#81',
    screens: ['prep'],
    title: 'The prep plan with two cook days',
    drawn: 'Two sections, one per cook day, each saying which days it covers and why the second exists.',
    options: ['One table with a day column'],
  },
  {
    key: 'Q11',
    issue: '#81',
    screens: ['grocery'],
    title: 'One grocery list for the week',
    drawn: 'One list, both cooks summed (with the split under the name), raw weight, eggs and bananas in pieces. Ticks are kept on the phone only.',
    options: ['Two lists, one per cook day, for two shops'],
  },
  {
    key: 'Q12',
    issue: '#81',
    screens: ['prep', 'batch'],
    title: 'What ticking a prep row does',
    drawn: 'It marks the row cooked and opens <strong>Record a batch</strong> with the raw grams filled in, so weighing the batch is one step on.',
    options: ['The tick only marks it cooked; batches are recorded separately'],
  },
  {
    key: 'Q13',
    issue: '#78',
    screens: ['foods', 'groups'],
    title: 'How the food list is ordered',
    drawn: 'One list by name, each row tagged with its rotation group. Groups have their own screen.',
    options: ['The list grouped under its rotation groups'],
  },
  {
    key: 'Q14',
    issue: '#78',
    screens: ['confirm', 'label'],
    title: 'The check screen after a label read',
    drawn: 'An <strong>As printed</strong> box with the label’s basis and values, then the per-100 g fields that will be saved.',
    options: ['Per-100 g fields only, with the label’s basis in one line'],
  },
  {
    key: 'Q15',
    issue: '#76',
    screens: ['weigh'],
    title: 'The time on a typed weight',
    drawn: 'Starts at now and can be changed, so a morning weigh-in typed at lunch still counts as the morning’s.',
    options: ['Always now, not changeable'],
  },
  {
    key: 'Q16',
    issue: '#76',
    screens: ['weight'],
    title: 'The weight chart’s span',
    drawn: 'Two: <strong>30 days</strong> and <strong>since the phase began</strong>.',
    options: ['4 weeks, 12 weeks and a year, as Strength has', '30 days only, as screen 6 drew it'],
  },
  {
    key: 'Q17',
    issue: '#82',
    screens: ['weight', 'low'],
    title: 'What Apply to targets sets on a cut',
    drawn: 'Calories become the maintenance estimate less the deficit for the phase’s rate (here about 2,700 − 450 = 2,250). It asks once, saying both numbers and that unconfirmed meals are planned again.',
    options: ['Calories become the maintenance figure itself; lower them by hand', 'Apply without asking'],
  },
  {
    key: 'Q18',
    issue: '#79',
    screens: ['today', 'phase', 'routine'],
    title: 'Where the plan’s settings live',
    drawn: '<strong>Your plan</strong> at the foot of Today opens the goal phase and your day. Weight’s phase line opens the goal phase too.',
    options: ['A Plan section in the Food tab'],
  },
  {
    key: 'Q19',
    issue: '#79',
    screens: ['today', 'routine'],
    title: 'What meals are called',
    drawn: 'Named from their place in the day: Breakfast, Lunch, Before training, After training, Evening.',
    options: ['Numbered: Meal 1 to Meal 5', 'Named by me in the day settings'],
  },
];

function renderQuestions() {
  document.getElementById('questions').innerHTML = QUESTIONS.map(
    (q) => `<form class="question" id="q-${q.key}" data-lavish-question="${q.key}" data-key="${q.key}">
      <div class="question__head"><span class="question__key">${q.key} · ${q.issue}</span><span class="question__title">${q.title}</span></div>
      <p class="question__applied"><span class="question__applied-word">${q.open ? 'Both drawn, not chosen' : 'As drawn in the prototype'}</span>${q.drawn}</p>
      <div class="question__options">
        ${q.open ? '' : '<label class="question__option"><input type="radio" name="' + q.key + '" value="Keep it as drawn"> Keep it as drawn</label>'}
        ${q.options.map((o) => `<label class="question__option"><input type="radio" name="${q.key}" value="${esc(o)}"> ${o}</label>`).join('')}
        <label class="question__option"><input type="radio" name="${q.key}" value="Something else"> Something else (say what below)</label>
      </div>
      <textarea class="question__note" name="${q.key}-note" rows="1" placeholder="Optional note" aria-label="Note for ${q.key}"></textarea>
      <div class="question__foot"><button type="submit" class="button button--secondary">Queue this answer</button><span class="question__status" role="status"></span></div></form>`,
  ).join('');
}

function queue(form, key, text, short, data) {
  const status = form.querySelector('.question__status');
  if (window.lavish?.queuePrompt === undefined) {
    status.textContent = 'Not sent: open this page through Lavish to queue answers.';
    return;
  }
  window.lavish.queuePrompt(text, { tag: key.startsWith('M1') ? 'm1-note' : 'question-answer', text: short, element: form, queueKey: key, data });
  status.textContent = `Queued: ${short}. Press Send to Agent when you are done.`;
}

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form.question, form.m1-notes');
  if (form === null) return;
  event.preventDefault();
  const data = new FormData(form);
  const status = form.querySelector('.question__status');
  if (form.classList.contains('m1-notes')) {
    const note = String(data.get('m1-note') ?? '').trim();
    const where = String(data.get('m1-where') ?? '').trim();
    if (note === '') {
      status.textContent = 'Write the note first.';
      return;
    }
    const key = `M1-${Date.now()}`;
    queue(form, key, `M1 look-and-feel note${where ? ` (${where})` : ''}: ${note}`, `M1 note${where ? ` on ${where}` : ''}`, { where, note });
    form.reset();
    return;
  }
  const key = form.dataset.key;
  const q = QUESTIONS.find((item) => item.key === key);
  const answer = data.get(key);
  const note = String(data.get(`${key}-note`) ?? '').trim();
  if (answer === null && note === '') {
    status.textContent = 'Choose an answer or write a note first.';
    return;
  }
  const text = `${key} (${q.issue}) ${q.title}: ${answer ?? 'note only'}${note === '' ? '' : `. Note: ${note}`}`;
  queue(form, key, text, `${key}: ${answer ?? 'note'}`, { question: key, answer, note });
});

renderQuestions();
render(true);
