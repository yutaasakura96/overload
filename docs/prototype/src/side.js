// The page round the phone: the screen map, the note for the screen on show, and the open questions.

const pushA = () => DB.routines.find((r) => r.id === 'push-a');
const lastPush = () => DB.workouts.findLast((w) => w.routineId === 'push-a');
const onWorkout = () => S.screen === 'workout' && S.live !== null;

const MAP = [
  { id: 'today', issue: 'START HERE', name: 'Today, as the hub', on: () => S.screen === 'today', jump: () => root('today') },
  {
    id: 'workout',
    issue: '#47',
    name: 'Workout: last time, target, rest',
    on: () => onWorkout() && !S.full && liveEntry().last !== null,
    jump() {
      startWorkout(pushA(), 'mid');
      S.full = false;
      root('workout');
    },
  },
  {
    id: 'first',
    issue: '#47',
    name: 'First workout of an exercise',
    on: () => onWorkout() && !S.full && liveEntry().last === null,
    jump() {
      if (S.live === null || S.live.routineId !== 'push-a') startWorkout(pushA(), 'mid');
      S.live.cur = S.live.exercises.findIndex((e) => e.exId === 'lateral');
      S.live.rest = null;
      S.full = false;
      openDraft();
      root('workout');
    },
  },
  {
    id: 'full',
    issue: '#51',
    name: 'Full-screen workout mode',
    on: () => onWorkout() && S.full,
    jump() {
      startWorkout(pushA(), 'mid');
      S.full = true;
      root('workout');
    },
  },
  { id: 'guide', issue: '#51', name: 'iPhone Focus guide', on: () => S.screen === 'guide', jump: () => root('guide') },
  { id: 'history', issue: '#48', name: 'History, by date', on: () => S.screen === 'history', jump: () => ACT.progTab({ id: 'history' }) },
  {
    id: 'detail',
    issue: '#48',
    name: 'One workout: edit and delete a set',
    on: () => S.screen === 'detail',
    jump() {
      S.progTab = 'history';
      S.stack = [{ screen: 'history', detailId: null, exId: S.exId, exSpan: S.exSpan }];
      S.detailId = lastPush().id;
      go('detail', { push: false });
    },
  },
  {
    id: 'exercise',
    issue: '#48',
    name: 'An exercise: chart and past sets',
    on: () => S.screen === 'exercise',
    jump() {
      S.stack = [{ screen: 'strength', detailId: null, exId: 'bench', exSpan: '12w' }];
      S.exId = 'bench';
      S.exSpan = '12w';
      go('exercise', { push: false });
    },
  },
  { id: 'strength', issue: '#49', name: 'Strength overview', on: () => S.screen === 'strength', jump: () => ACT.progTab({ id: 'strength' }) },
  { id: 'balance', issue: '#50', name: 'Muscle balance', on: () => S.screen === 'balance' && !S.atStepTwo, jump: () => ACT.progTab({ id: 'balance' }) },
  {
    id: 'suggest',
    issue: '#50 · SECOND STEP',
    name: 'One-tap suggestions',
    on: () => S.screen === 'balance' && S.atStepTwo,
    jump() {
      ACT.progTab({ id: 'balance' });
      S.atStepTwo = true;
      document.getElementById('step-two').scrollIntoView({ block: 'start' });
      renderSide();
    },
  },
  { id: 'exercises', issue: '#41', name: 'Exercise filter', on: () => S.screen === 'exercises' || S.screen === 'routines', jump: () => root('exercises') },
];
const JUMP = { jump: ({ id }) => MAP.find((m) => m.id === id).jump() };

const NOTES = {
  today: {
    title: 'Today, as the hub',
    points: [
      'A fourth tab, <strong>Progress</strong>, holds History, Strength and Balance.',
      'Each routine says when it was last done.',
      '<strong>Last workout</strong> opens straight into what was lifted.',
      '<strong>How it is going</strong> gives the strength and balance verdicts in one line each.',
    ],
    tryIt: 'Tap <strong>START</strong> on Push A to begin the workout flow.',
  },
  workout: {
    title: 'Workout: last time, today\'s target, and the rest timer (#47)',
    points: [
      '<strong>Last time</strong> and <strong>Today\'s target</strong> sit on top of the exercise, at the app\'s figure size. The target says in words whether the weight goes up and what earns the next increase.',
      'The rest bar is on screen from the start, so it is seen before it is needed. The countdown is 42px, up from 30px.',
      'The suggestion chip and the <code>6–10 · +2.5</code> header code are gone: the target line says both in plain words.',
      'A logged set opens for editing from its tick (owed since slice 3).',
    ],
    tryIt: 'Complete a set and watch the countdown. Open <strong>Seated Dumbbell Shoulder Press</strong> under Up next for a target that goes up. Tap a set\'s tick to edit it.',
    actions: [['restJump', 'Skip to 5 seconds left']],
  },
  first: {
    title: 'First workout of an exercise (#47)',
    points: [
      'With no history, the two lines say so and say why: nothing to compare with yet.',
      'The target becomes an instruction for finding a starting weight, and promises what the line will show next time.',
      'The weight opens empty. Completing a set without one is refused on the card.',
    ],
    tryIt: 'Type a weight and complete the set. Then use the map to compare with an exercise that has history.',
  },
  full: {
    title: 'Full-screen workout mode (#51)',
    points: [
      'Entered from <strong>FULL SCREEN</strong> on the rest bar. Tabs, the other exercises and Finish are gone.',
      'Resting: the countdown at 56px, and the next set under it. Lifting: the target and the set card, nothing else.',
      'The last line is the way to the iPhone Focus guide, since the app itself cannot silence the phone.',
      'The set that finishes an exercise moves on to the next one, as today.',
    ],
    tryIt: 'Skip the rest, complete a set, and let the rest run out.',
    actions: [['restJump', 'Skip to 5 seconds left']],
  },
  guide: {
    title: 'iPhone Focus guide (#51)',
    points: [
      'Four steps, each with the path in Settings, taken from Apple\'s iPhone User Guide for iOS 27.',
      'It opens by saying what a web app cannot do: turn a Focus on, or block other apps.',
      'Ticking the steps is kept on the phone only. Nothing is checked against iOS, because nothing can be.',
    ],
    tryIt: 'Tick the steps, then <strong>I have set it up</strong>. Full screen then stops asking.',
  },
  history: {
    title: 'History, by date (#48)',
    points: [
      'Every finished workout, newest first, under its month: routine, date, length, sets, and the top set of each exercise.',
      'A year of sample data: 194 workouts of Push, Pull and Legs.',
    ],
    tryIt: 'Open a workout. Finish the workout in progress and it appears at the top.',
  },
  detail: {
    title: 'One workout: edit and delete a set (#48)',
    points: [
      'Every set as it was logged, warm-ups included. An exercise name opens that exercise\'s own past sets.',
      'A set opens into three fields: weight, reps, RIR. Delete asks once, in place.',
      'An edit feeds everything derived from the set: the charts, last time and today\'s target.',
      'Deleting a workout\'s last set removes the workout.',
    ],
    tryIt: 'Edit a Bench Press set to 10 reps, then start Push A: the target has gone up. Delete a set.',
  },
  exercise: {
    title: 'An exercise: its chart and its past sets (#48)',
    points: [
      'The chart screen that exists today, with <strong>Past sets</strong> under it in place of the "Workouts in this span" table.',
      'Each row is one workout: every working set, and that day\'s e1RM. It opens the workout.',
      'Reached from the workout screen\'s Last time line, a workout in History, the exercise library and the strength overview.',
    ],
    tryIt: 'Change the span. Open a row.',
  },
  strength: {
    title: 'Strength overview (#49)',
    points: [
      'One figure answers "stronger or weaker": the average change of every lift\'s e1RM trend over the span.',
      'Each lift is <strong>gaining</strong>, <strong>holding</strong> or <strong>losing</strong>, by the word and the sign, not colour alone.',
      'Three spans, as asked: 4 weeks, 12 weeks, a year. The same lift can read differently in each: Bench Press is gaining over 12 weeks and holding over 4.',
    ],
    tryIt: 'Switch between the three spans. Open a lift.',
  },
  balance: {
    title: 'Muscle balance (#50)',
    points: [
      'Working sets a week for each of the eleven muscle groups, against a 10–20 range.',
      'The range carries the evidence tag the design system already defines. It opens the sources.',
      'A set counts whole for the exercise\'s own muscle group and half for one it trains indirectly, so pressing counts towards triceps.',
      'The default is the four-week average: a week in progress always looks low.',
    ],
    tryIt: 'Open the evidence tag. Tap Triceps to see where its sets came from. Switch to This week.',
  },
  suggest: {
    title: 'One-tap suggestions (#50, second step)',
    points: [
      'Marked off from the first build. Two kinds: muscle groups trained too little, and a lift that has stopped gaining.',
      'A suggestion is a whole routine with its reason and its evidence. One tap adds it to Routines.',
      '"Stale" is a lift with no gain for weeks, not a routine that is merely old: repeating a routine that still progresses is the method working.',
    ],
    tryIt: 'Tap <strong>Add as a routine</strong>, then <strong>Start now</strong>. Every exercise in it is a first workout.',
  },
  exercises: {
    title: 'Exercise filter (#41)',
    points: [
      'A split filter over the library: push, pull, legs, core. Choosing a split offers its muscle groups.',
      'The split is worked out from the muscle group each exercise already has. Nothing new is stored.',
    ],
    tryIt: 'Choose Legs, then Hamstrings. Search still works inside the filter.',
  },
};

function renderSide() {
  const current = MAP.find((m) => m.on()) ?? MAP[0];
  if (S.screen !== 'balance') S.atStepTwo = false;
  document.getElementById('phone-caption').textContent = `${current.issue} · ${current.name}`;
  document.getElementById('map').innerHTML = MAP.map(
    (m) => `<button type="button" class="screen-map__item" data-act="jump" data-id="${m.id}" aria-current="${m === current}"><span class="screen-map__issue">${m.issue}</span><span class="screen-map__name">${m.name}</span></button>`,
  ).join('');
  const note = NOTES[current.id];
  document.getElementById('now').innerHTML = `<span class="now__label">On the phone now</span><h3>${note.title}</h3>
    <ul>${note.points.map((p) => `<li>${p}</li>`).join('')}</ul>
    <p class="now__try"><strong>Try:</strong> ${note.tryIt}</p>
    ${note.actions ? `<div class="now__actions">${note.actions.map(([act, label]) => `<button type="button" class="button button--secondary" data-act="${act}">${label}</button>`).join('')}</div>` : ''}`;
}

const QUESTIONS = [
  {
    key: 'Q1',
    issue: '#47',
    title: 'The line is labelled "Today\'s target"',
    applied: 'The screen says <strong>Today\'s target</strong>. The glossary keeps <em>suggestion</em> as the term in code and docs, and lists "target weight" under Avoid, so it gets a note that the on-screen label differs, as it already has for workout and "session".',
    options: ['Say "Suggested" on screen as well, to match the glossary'],
  },
  {
    key: 'Q2',
    issue: '#47',
    title: 'The target line replaces the suggestion chip and the header code',
    applied: 'The line says in words whether the weight goes up and what earns the next increase. The <code>SUGGESTED 82.5</code> chip inside the set card and the <code>6–10 · +2.5</code> in the header are removed, since they said the same thing in code.',
    options: ['Keep the chip in the set card too'],
  },
  {
    key: 'Q3',
    issue: '#47',
    title: 'The rest bar is on screen for the whole workout',
    applied: 'Before the first set it reads "Starts by itself after each set: 3:00". Today the bar only appears once a set is done, which is why it was not noticed. It costs about 70px of the screen.',
    options: ['Show it only while rest is running, as today, just larger'],
  },
  {
    key: 'Q4',
    issue: '#47 #51',
    title: 'Countdown size: 42px on the bar, 56px in full screen',
    applied: '42px is the largest size the type scale allows outside the active set. 56px is reserved for the active set (design system §2.6), so using it for the full-screen countdown needs a decision-log entry. Only one 56px element is ever on screen: the countdown while resting, the set while lifting.',
    options: ['42px in both, and no change to the type scale', 'Larger than 56px in full screen'],
  },
  {
    key: 'Q5',
    issue: '#48',
    title: 'A set logged today is edited from its tick',
    applied: 'Tapping the green tick of a logged set opens the same editor History uses. This closes the "edit or delete a ticked set" gap flow F3 has carried since slice 3.',
    options: ['Show the word EDIT on the row instead of relying on the tick'],
  },
  {
    key: 'Q6',
    issue: '#51',
    title: 'The app\'s mode is "Full screen"; "Focus" means Apple\'s',
    applied: 'Two things called Focus would be confused, and only Apple\'s can silence the phone. The issue\'s title, "Focus mode", becomes <strong>Full screen</strong> on screen.',
    options: ['Call the app\'s mode "Focus mode" anyway'],
  },
  {
    key: 'Q7',
    issue: '#51',
    title: 'Full screen is turned on by hand, each workout',
    applied: 'It is one tap on the rest bar and one tap out. It is not remembered and never turns on by itself.',
    options: ['Remember my last choice for the next workout', 'Open every workout in full screen'],
  },
  {
    key: 'Q8',
    issue: '#48',
    title: 'What History can change',
    applied: 'A set\'s weight, reps and RIR, and deleting a set. Deleting a workout\'s last set removes the workout. Not offered: adding a set to a past workout, moving a set, changing the date. An edited set carries no "edited" mark.',
    options: ['Also allow adding a set to a past workout', 'Also offer "Delete workout" as one action'],
  },
  {
    key: 'Q9',
    issue: '#48 #49 #50',
    title: 'Where the new screens live',
    applied: 'One new tab, <strong>Progress</strong>, with History, Strength and Balance inside it. Today links to the last workout and to both summaries. Five tabs do not fit a 390px screen at the current size.',
    options: ['History as its own tab, Strength and Balance elsewhere'],
  },
  {
    key: 'Q10',
    issue: '#48',
    title: 'An exercise\'s past sets go on its chart screen',
    applied: 'Under the chart, replacing the "Workouts in this span" table, so an exercise has one place. The chart screen becomes reachable from the workout, History, the library and the strength overview.',
    options: ['A separate past-sets screen, leaving the chart screen as it is'],
  },
  {
    key: 'Q11',
    issue: '#48',
    title: 'Finishing a workout lands on its History page',
    applied: 'Flow F3 still owes a finish summary. The workout\'s own page in History is that summary: sets, volume, time, and every set open to correction while it is fresh.',
    options: ['Go back to Today, as now'],
  },
  {
    key: 'Q12',
    issue: '#49',
    title: 'How "gaining, holding, losing" is decided',
    applied: 'One measure, e1RM, so more reps at the same weight counts as stronger. A straight trend line through the span\'s workouts: up 2% or more is gaining, down 2% or more is losing. A lift needs three workouts in the span. The overall figure is the plain average of the lifts.',
    options: ['Compare the latest workout with the span\'s first: simpler, and equal to each chart\'s headline, but one bad day flips a lift to losing', 'Show volume load as a second measure'],
  },
  {
    key: 'Q13',
    issue: '#50',
    title: 'The range, and counting indirect work',
    applied: '10 to 20 working sets a week for every muscle group, rated moderate. A set counts half for a muscle it trains indirectly. That needs each exercise to carry secondary muscle groups: new data for all 185 seeded exercises, and a change to the glossary rule of one muscle group per exercise (the filing stays by the one).',
    options: ['Count direct sets only: no new data, but a week of pressing shows triceps as low', 'Different ranges for small muscle groups such as calves and forearms'],
  },
  {
    key: 'Q14',
    issue: '#50',
    title: 'The window: a four-week average first',
    applied: 'The default view averages the last 28 days. "This week" is the second view, because a week in progress reads low until its last workout.',
    options: ['This week first'],
  },
  {
    key: 'Q15',
    issue: '#50 second step',
    title: 'What a suggestion creates, and what "stale" means',
    applied: 'One tap adds a <strong>routine</strong>, which is saved, editable, and can be started at once. A lift is stale when it has not gained for six weeks or more, not when a routine has simply been repeated for a long time.',
    options: ['Start a one-off workout without saving a routine', 'Also flag a routine by age alone, such as unchanged for 12 weeks'],
  },
  {
    key: 'Q16',
    issue: '#41',
    title: 'Splits come from the muscle group',
    applied: 'Push is chest, shoulders and triceps. Pull is back, biceps and forearms. Legs is quads, hamstrings, glutes and calves. Core is core. Nothing is stored per exercise.',
    options: ['Store a split on each exercise, so one can be moved'],
  },
];

function renderQuestions() {
  document.getElementById('questions').innerHTML = QUESTIONS.map(
    (q) => `<form class="question" data-lavish-question="${q.key}" data-key="${q.key}">
      <div class="question__head"><span class="question__key">${q.key} · ${q.issue}</span><span class="question__title">${q.title}</span></div>
      <p class="question__applied"><span class="question__applied-word">Recommended, and applied in the prototype</span>${q.applied}</p>
      <div class="question__options">
        <label class="question__option"><input type="radio" name="${q.key}" value="Keep it as prototyped"> Keep it as prototyped</label>
        ${q.options.map((o) => `<label class="question__option"><input type="radio" name="${q.key}" value="${esc(o)}"> ${o}</label>`).join('')}
        <label class="question__option"><input type="radio" name="${q.key}" value="Something else"> Something else (say what below)</label>
      </div>
      <textarea class="question__note" name="${q.key}-note" rows="1" placeholder="Optional note" aria-label="Note for ${q.key}"></textarea>
      <div class="question__foot"><button type="submit" class="button button--secondary">Queue this answer</button><span class="question__status" role="status"></span></div></form>`,
  ).join('');
}

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form.question');
  if (form === null) return;
  event.preventDefault();
  const key = form.dataset.key;
  const q = QUESTIONS.find((item) => item.key === key);
  const data = new FormData(form);
  const answer = data.get(key);
  const note = String(data.get(`${key}-note`) ?? '').trim();
  const status = form.querySelector('.question__status');
  if (answer === null && note === '') {
    status.textContent = 'Choose an answer or write a note first.';
    return;
  }
  const text = `${key} (${q.issue}) ${q.title}: ${answer ?? 'note only'}${note === '' ? '' : `. Note: ${note}`}`;
  if (window.lavish?.queuePrompt === undefined) {
    status.textContent = 'Not sent: open this page through Lavish to queue answers.';
    return;
  }
  window.lavish.queuePrompt(text, { tag: 'question-answer', text: `${key}: ${answer ?? 'note'}`, element: form, queueKey: key, data: { question: key, answer, note } });
  status.textContent = `Queued: ${answer ?? 'note'}. Press Send to Agent when you are done.`;
});

renderQuestions();
render(true);
