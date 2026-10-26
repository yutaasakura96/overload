import type { Food, Me, RotationGroup } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  AccountFooter,
  AppBar,
  CheckIcon,
  Chevron,
  DataState,
  Notice,
  ScreenTabs,
  TextField,
} from '../components';
import { macroLine } from '../food';
import { useEntryNote, type Navigate } from '../navigation';
import { foodsQuery, rotationGroupsQuery, useAccount } from '../query';
import { FoodSections } from './Prep';

// The food list (S12; docs/10 §8.6, approved in the M2 prototype, screens 15 and 16): one flat
// list by name (Q13), each food tagged with its rotation group and how the plan uses it. The plan
// is built only from these foods. The third of the Food tab's sections, after Prep and Grocery.

export function Foods({ me, navigate }: { me: Me; navigate: Navigate }) {
  // The saved copy shows until /api/me confirms the account; no fetch runs under an unconfirmed one.
  const confirmed = useAccount().status === 'confirmed';
  const foods = useQuery({ ...foodsQuery, enabled: confirmed });
  const groups = useQuery({ ...rotationGroupsQuery, enabled: confirmed });
  const note = useEntryNote();
  const [search, setSearch] = useState('');
  const listed = useMemo(
    () => (foods.data ?? []).filter((food) => food.archivedAt === null),
    [foods.data],
  );
  const words = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      words === ''
        ? listed
        : listed.filter((food) => `${food.name} ${food.brand ?? ''}`.toLowerCase().includes(words)),
    [listed, words],
  );
  const groupNames = new Map((groups.data ?? []).map((group) => [group.id, group.name]));
  const addFood = () => navigate('/food/new', { returns: true });

  return (
    <main className="foods-screen">
      <AppBar
        title="Food"
        subline={foods.data === undefined ? 'YOUR FOODS' : `YOUR FOODS · ${listed.length}`}
        slot={<DataState at={foods.dataUpdatedAt} />}
      />
      <ScreenTabs current="/food" navigate={navigate} />
      <FoodSections current="/food/list" navigate={navigate} />

      {foods.isError && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {foods.data === undefined ? 'Try again when you have signal.' : 'Showing the last copy.'}
        </Notice>
      )}
      {note === 'food-saved' && (
        <output className="saved-line">
          <CheckIcon size={13} color="var(--done)" />
          Saved to your foods, per 100 g.
        </output>
      )}
      {note === 'food-archived' && (
        <output className="saved-line">
          <CheckIcon size={13} color="var(--done)" />
          Archived. Past plans still name it.
        </output>
      )}

      {foods.data !== undefined && listed.length === 0 && (
        <section className="empty-state" aria-labelledby="no-foods">
          <h2 id="no-foods" className="empty-state__title">
            No foods yet
          </h2>
          <p className="empty-state__body">
            The meal plan is built only from your foods. Add the ones you eat, starting with a
            protein source: chicken, eggs, fish or tofu.
          </p>
          <button type="button" className="button button--primary" onClick={addFood}>
            Add a food
          </button>
        </section>
      )}

      {listed.length > 0 && (
        <>
          <div className="food-field">
            <TextField
              label="Search your foods"
              type="search"
              value={search}
              onChange={setSearch}
              placeholder="Name or brand"
            />
          </div>
          <div className="section-actions section-actions--tight">
            <button type="button" className="button button--primary" onClick={addFood}>
              Add a food
            </button>
          </div>
          <h2 className="visually-hidden" aria-live="polite">
            {words === '' ? 'Your foods' : `${shown.length} matching`}
          </h2>
          <ul className="foods">
            {shown.length === 0 ? (
              <li className="foods__none">
                None of your foods match “{search.trim()}”.{' '}
                <button type="button" className="inline-link" onClick={addFood}>
                  Add it as a new food
                </button>
              </li>
            ) : (
              shown.map((food) => (
                <FoodRow
                  key={food.id}
                  food={food}
                  group={
                    food.rotationGroupId === null ? undefined : groupNames.get(food.rotationGroupId)
                  }
                  navigate={navigate}
                />
              ))
            )}
          </ul>
          <GroupsLink groups={groups.data} navigate={navigate} />
          <footer className="footnote footnote--after">
            <span>Values per 100 g of the state named</span>
            <span className="footnote__formula">raw or cooked</span>
          </footer>
        </>
      )}

      <AccountFooter email={me.user.email} admin={me.isAdmin} navigate={navigate} />
    </main>
  );
}

function FoodRow({
  food,
  group,
  navigate,
}: {
  food: Food;
  group: string | undefined;
  navigate: Navigate;
}) {
  const path = `/food/${food.id}`;
  const tags = [
    group,
    food.keepsDays === null ? undefined : `Batch-cooked · keeps ${food.keepsDays} days`,
    food.pieceWeightG === null ? undefined : 'Counted in pieces',
  ].filter((tag) => tag !== undefined);
  return (
    <li>
      <a
        href={path}
        className="foods__row"
        onClick={(event) => {
          event.preventDefault();
          navigate(path, { returns: true });
        }}
      >
        <span>
          <span className="foods__name">
            {food.name}
            {food.brand !== null && <span className="foods__brand"> · {food.brand}</span>}
          </span>
          <span className="foods__macros">{macroLine(food)}</span>
          {tags.length > 0 && (
            <span className="foods__tags">
              {tags.map((tag) => (
                <span key={tag} className="foods__tag">
                  {tag}
                </span>
              ))}
            </span>
          )}
        </span>
        <Chevron direction="forward" />
      </a>
    </li>
  );
}

function GroupsLink({
  groups,
  navigate,
}: {
  groups: RotationGroup[] | undefined;
  navigate: Navigate;
}) {
  const count = groups?.length ?? 0;
  return (
    <a
      href="/food/groups"
      className="link-row"
      onClick={(event) => {
        event.preventDefault();
        navigate('/food/groups', { returns: true });
      }}
    >
      <span>
        <span className="link-row__name">Rotation groups</span>
        <span className="link-row__meta">
          {count === 0
            ? 'Foods that stand in for each other'
            : `${count} ${count === 1 ? 'group' : 'groups'}: foods that stand in for each other`}
        </span>
      </span>
      <Chevron direction="forward" />
    </a>
  );
}
