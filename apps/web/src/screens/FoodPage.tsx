import type { Food } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, expectOk } from '../api';
import { AppBar, DataState, DeleteConfirm, Notice } from '../components';
import { figure, nutrientFigure, NUTRIENTS, sourceLine } from '../food';
import { goBack, type Navigate } from '../navigation';
import { foodsQuery, forAccount, refreshFoods, rotationGroupsQuery, useAccount } from '../query';
import { saveProblem, SaveNotice, type SaveProblem } from '../saving';

// One food (docs/10 §8.6, the M2 prototype's screen 17): its values per 100 g, how the plan uses
// it, and Edit and Archive. Batches join it with their slice (S13).

export function FoodPage({ id, navigate }: { id: string; navigate: Navigate }) {
  const confirmed = useAccount().status === 'confirmed';
  const foods = useQuery({ ...foodsQuery, enabled: confirmed });
  const groups = useQuery({ ...rotationGroupsQuery, enabled: confirmed });
  const food = foods.data?.find((each) => each.id === id);
  const back = () => goBack(navigate, '/food');

  return (
    <main>
      <AppBar
        title={food?.name ?? 'Food'}
        subline={food === undefined ? undefined : sourceLine(food)}
        slot={<DataState at={foods.dataUpdatedAt} />}
        back={{ label: 'Back to your foods', onClick: back }}
      />
      {foods.isError && foods.data === undefined && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload. Try again when you have signal.
        </Notice>
      )}
      {foods.data !== undefined && food === undefined && (
        <section className="empty-state" aria-labelledby="no-food">
          <h2 id="no-food" className="empty-state__title">
            Not on your list
          </h2>
          <p className="empty-state__body">
            This food doesn’t exist. It may have been removed on another device.
          </p>
          <button type="button" className="button button--secondary" onClick={back}>
            Back to your foods
          </button>
        </section>
      )}
      {food !== undefined && (
        <FoodDetail
          food={food}
          group={groups.data?.find((each) => each.id === food.rotationGroupId)?.name}
          navigate={navigate}
        />
      )}
    </main>
  );
}

function FoodDetail({
  food,
  group,
  navigate,
}: {
  food: Food;
  group: string | undefined;
  navigate: Navigate;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const archived = food.archivedAt !== null;

  const archive = async () => {
    setBusy(true);
    setProblem(undefined);
    let saved = false;
    try {
      await forAccount(async () =>
        expectOk(await api.DELETE('/api/foods/{id}', { params: { path: { id: food.id } } })),
      );
      saved = true;
      await refreshFoods();
      navigate('/food', { replace: true, note: 'food-archived' });
    } catch (error) {
      setProblem(saved ? { kind: 'plan_failed' } : saveProblem(error));
      setBusy(false);
    }
  };

  return (
    <>
      {archived && (
        <Notice tone="flag" word="Archived" quiet>
          Off your list and out of new plans. Past plans still name it.
        </Notice>
      )}
      <SaveNotice problem={problem} what="food" />
      <section className="today__section" aria-labelledby="per-100g">
        <h2 id="per-100g" className="section-label">
          Per 100 g, {food.state}
        </h2>
        <dl className="values">
          {NUTRIENTS.map((nutrient) => (
            <div key={nutrient.key} className="values__row">
              <dt>{nutrient.label}</dt>
              <dd>
                {nutrientFigure(nutrient.key, food[nutrient.key])}
                <span className="values__unit"> {nutrient.unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="today__section" aria-labelledby="plan-use">
        <h2 id="plan-use" className="section-label">
          How the plan uses it
        </h2>
        <dl className="values">
          <div className="values__row">
            <dt>Counted in</dt>
            <dd className="values__word">
              {food.pieceWeightG === null ? 'grams' : `pieces of ${figure(food.pieceWeightG)} g`}
            </dd>
          </div>
          <div className="values__row">
            <dt>Rotation group</dt>
            <dd className="values__word">{group ?? 'None'}</dd>
          </div>
          <div className="values__row">
            <dt>Batch-cooked</dt>
            <dd className="values__word">
              {food.keepsDays === null ? 'No' : `Yes, keeps ${food.keepsDays} days`}
            </dd>
          </div>
        </dl>
      </section>
      {!archived && (
        <>
          <div className="section-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => navigate(`/food/${food.id}/edit`, { returns: true })}
            >
              Edit
            </button>
            <DeleteConfirm
              label="Archive"
              question={`Archive ${food.name}? It leaves your list and new plans.`}
              busy={busy}
              keepLabel="Keep"
              confirmLabel="Archive"
              onDelete={() => void archive()}
            />
          </div>
          <p className="food-hint food-hint--gutter">
            Archiving takes it off your list and out of new plans. Past plans keep it.
          </p>
        </>
      )}
    </>
  );
}
