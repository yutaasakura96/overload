import type { Food, RotationGroup } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { api, expectOk, unwrap } from '../api';
import { AppBar, DataState, FieldLabel, Notice, TextField } from '../components';
import { newId } from '../ids';
import { goBack, type Navigate } from '../navigation';
import { foodsQuery, forAccount, refreshFoods, rotationGroupsQuery, useAccount } from '../query';
import { saveProblem, SaveNotice, type SaveProblem } from '../saving';

// Rotation groups (S12; docs/10 §8.6, the prototype's screen 23): foods that stand in for each
// other. The planner varies the week within a group, and Adjust offers the others as swaps. A food
// is in one group at most, so adding it here takes it out of any other.

export function RotationGroups({ navigate }: { navigate: Navigate }) {
  const confirmed = useAccount().status === 'confirmed';
  const groups = useQuery({ ...rotationGroupsQuery, enabled: confirmed });
  const foods = useQuery({ ...foodsQuery, enabled: confirmed });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const [creating, setCreating] = useState(false);
  // Where focus goes when the control pressed goes away: a form closed or a group deleted.
  const newGroup = useRef<HTMLButtonElement>(null);
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus > 0) newGroup.current?.focus();
  }, [refocus]);
  const closeNew = () => {
    setCreating(false);
    setRefocus((count) => count + 1);
  };
  const listed = (foods.data ?? []).filter((food) => food.archivedAt === null);
  const names = new Map(listed.map((food) => [food.id, food.name]));
  const back = () => goBack(navigate, '/food');

  const run = async (write: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await forAccount(write);
      await refreshFoods();
      setBusy(false);
      return true;
    } catch (error) {
      setProblem(saveProblem(error));
      setBusy(false);
      return false;
    }
  };
  const setMembers = (group: RotationGroup, foodIds: string[]) =>
    run(async () =>
      unwrap(
        await api.PATCH('/api/rotation-groups/{id}', {
          params: { path: { id: group.id } },
          body: { foodIds },
        }),
      ),
    );
  const remove = (group: RotationGroup) =>
    run(async () =>
      expectOk(
        await api.DELETE('/api/rotation-groups/{id}', { params: { path: { id: group.id } } }),
      ),
    );

  return (
    <main>
      <AppBar
        title="Rotation groups"
        slot={<DataState at={groups.dataUpdatedAt} />}
        back={{ label: 'Back to your foods', onClick: back }}
      />
      {(groups.isError || foods.isError) && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {groups.data === undefined ? 'Try again when you have signal.' : 'Showing the last copy.'}
        </Notice>
      )}
      <SaveNotice problem={problem} what="group" />
      <p className="food-lede">
        Foods that stand in for each other. The planner picks within a group to vary the week, and
        Adjust offers the others as swaps.
      </p>
      {groups.data !== undefined && groups.data.length === 0 && !creating && (
        <p className="foods__none">
          No groups yet. Okra and broccoli, or rice and potato, are the kind of pair a group holds.
        </p>
      )}
      {(groups.data ?? []).map((group) => (
        <GroupSection
          key={group.id}
          group={group}
          names={names}
          foods={listed}
          busy={busy}
          onMembers={(foodIds) => setMembers(group, foodIds)}
          onDelete={async () => {
            const done = await remove(group);
            if (done) setRefocus((count) => count + 1);
            return done;
          }}
        />
      ))}
      {creating ? (
        <NewGroup
          busy={busy}
          onCancel={closeNew}
          onCreate={async (name) => {
            const made = await run(async () =>
              unwrap(
                await api.POST('/api/rotation-groups', {
                  body: { id: newId(), name, foodIds: [] },
                }),
              ),
            );
            if (made) closeNew();
          }}
        />
      ) : (
        <div className="section-actions">
          <button
            ref={newGroup}
            type="button"
            className="button button--secondary"
            disabled={busy || groups.data === undefined}
            onClick={() => setCreating(true)}
          >
            New group
          </button>
        </div>
      )}
    </main>
  );
}

function GroupSection({
  group,
  names,
  foods,
  busy,
  onMembers,
  onDelete,
}: {
  group: RotationGroup;
  names: Map<string, string>;
  foods: Food[];
  busy: boolean;
  onMembers: (foodIds: string[]) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState('');
  const selectId = useId();
  const headingId = useId();
  const others = foods.filter((food) => !group.foodIds.includes(food.id));
  const lower = group.name.toLowerCase();
  // A removed food's button and a closed form both take focus with them: it moves to the heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const changeMembers = async (foodIds: string[]) => {
    const done = await onMembers(foodIds);
    if (done) heading.current?.focus();
    return done;
  };

  return (
    <section className="today__section" aria-labelledby={headingId}>
      <h2 ref={heading} id={headingId} className="section-label" tabIndex={-1}>
        {group.name} · {group.foodIds.length}
      </h2>
      <ul className="group">
        {group.foodIds.map((foodId) => (
          <li key={foodId} className="group__row">
            <span>{names.get(foodId) ?? 'A food'}</span>
            <button
              type="button"
              className="button button--tertiary"
              disabled={busy}
              onClick={() => void changeMembers(group.foodIds.filter((each) => each !== foodId))}
            >
              Remove
              <span className="visually-hidden">
                {' '}
                {names.get(foodId)} from {group.name}
              </span>
            </button>
          </li>
        ))}
        {group.foodIds.length === 0 && (
          <li className="group__row group__row--empty">
            <span>No foods in it yet.</span>
            <button
              type="button"
              className="button button--tertiary"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              Delete the group
            </button>
          </li>
        )}
      </ul>
      {adding ? (
        <form
          className="group__add-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (choice === '') return;
            void changeMembers([...group.foodIds, choice]).then((done) => {
              if (done) {
                setAdding(false);
                setChoice('');
              }
            });
          }}
        >
          <div className="field">
            <FieldLabel htmlFor={selectId} label={`Add a food to ${lower}`} />
            <select
              id={selectId}
              className="field__input field__select"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value="">Choose a food</option>
              {others.map((food) => (
                <option key={food.id} value={food.id}>
                  {food.name}
                </option>
              ))}
            </select>
          </div>
          <div className="section-actions section-actions--flush">
            <button
              type="submit"
              className="button button--secondary"
              disabled={busy || choice === ''}
            >
              Add to {lower}
            </button>
            <button
              type="button"
              className="button button--tertiary"
              onClick={() => {
                setAdding(false);
                heading.current?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        others.length > 0 && (
          <button type="button" className="group__add" onClick={() => setAdding(true)}>
            + Add a food to {lower}
          </button>
        )
      )}
    </section>
  );
}

function NewGroup({
  busy,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  onCreate: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  return (
    <form
      className="form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === '' || trimmed.length > 80) {
          setError('Enter a name, up to 80 characters');
          return;
        }
        setError(undefined);
        void onCreate(trimmed);
      }}
    >
      <TextField
        label="Group name"
        value={name}
        onChange={setName}
        placeholder="Starch, green vegetable…"
        error={error}
        focusOnOpen
      />
      <div className="section-actions section-actions--flush">
        <button type="submit" className="button button--primary" disabled={busy}>
          Make the group
        </button>
        <button type="button" className="button button--tertiary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
