import type { ReferenceFood } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppBar, Chevron, DataState, Notice, TextField } from '../components';
import {
  figure,
  holdCandidate,
  kcal,
  manualCandidate,
  mextName,
  referenceName,
  valuesOf,
} from '../food';
import { goBack, type Navigate } from '../navigation';
import { referenceFoodsQuery, useAccount } from '../query';

// Add a food (docs/09 F9, in its order; docs/10 §8.6, the prototype's screen 18): the MEXT table
// first, then a barcode, a photo of the label, or by hand. A pick opens the check screen; nothing
// is saved until it is confirmed there.

/** A search starts from two characters, once typing pauses. */
const MIN_QUERY = 2;
const PAUSE_MS = 250;

function usePaused(value: string) {
  const [paused, setPaused] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setPaused(value), PAUSE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return paused;
}

export function AddFood({ navigate }: { navigate: Navigate }) {
  const confirmed = useAccount().status === 'confirmed';
  const [search, setSearch] = useState('');
  const q = usePaused(search.trim());
  const searching = q.length >= MIN_QUERY;
  const found = useQuery({ ...referenceFoodsQuery(q), enabled: confirmed && searching });
  const back = () => goBack(navigate, '/food');

  const pick = (entry: ReferenceFood) => {
    const values = valuesOf(entry);
    holdCandidate({
      source: 'mext',
      sourceRef: entry.code,
      sourceLine: `MEXT FOOD TABLE · ${entry.code}`,
      name: referenceName(entry),
      brand: null,
      state: entry.state,
      printed: null,
      per100g: values,
      existingFoodId: entry.existingFoodId,
    });
    navigate('/food/new/check', { returns: true });
  };
  const byHand = () => {
    holdCandidate(manualCandidate());
    navigate('/food/new/check', { returns: true });
  };

  return (
    <main>
      <AppBar
        title="Add a food"
        slot={<DataState at={found.dataUpdatedAt} />}
        back={{ label: 'Back to your foods', onClick: back }}
      />
      <div className="food-field">
        <TextField
          label="Search the MEXT food table"
          type="search"
          value={search}
          onChange={setSearch}
          placeholder="Chicken breast, 鶏 むね…"
          focusOnOpen
        />
      </div>
      <div aria-live="polite">
        {searching && found.isError && (
          <Notice tone="flag" word="Not searched">
            Couldn’t reach Overload. Try again when you have signal, or enter it by hand.
          </Notice>
        )}
        {searching && found.data !== undefined && found.data.length === 0 && (
          <p className="foods__none">
            Nothing in the MEXT table for “{q}”. A packaged food is quicker by its barcode.
          </p>
        )}
        {searching && found.data !== undefined && found.data.length > 0 && (
          <>
            <h2 className="visually-hidden">{found.data.length} matches in the MEXT table</h2>
            <ul className="pick">
              {found.data.map((entry) => (
                <li key={entry.code}>
                  <button type="button" className="pick__row" onClick={() => pick(entry)}>
                    <span className="pick__name">{referenceName(entry)}</span>
                    {entry.nameEn !== null && (
                      <span className="pick__jp" lang="ja">
                        {mextName(entry.name)}
                      </span>
                    )}
                    <span className="pick__meta">
                      {kcal(entry.energyKcal)} kcal · {figure(entry.proteinG)} g protein per 100 g ·
                      MEXT {entry.code}
                      {entry.existingFoodId !== null && ' · on your list'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <section className="today__section" aria-labelledby="not-in-table">
        <h2 id="not-in-table" className="section-label">
          Not in the table?
        </h2>
        <ul className="ways">
          <Way
            name="Scan a barcode"
            meta="For packaged food. Looked up in Open Food Facts."
            onClick={() => navigate('/food/new/barcode', { returns: true })}
          />
          <Way
            name="Photograph the label"
            meta="The 栄養成分表示, read for you. You check it before it is saved."
            onClick={() => navigate('/food/new/label', { returns: true })}
          />
          <Way
            name="Enter it by hand"
            meta="Copy the numbers from the packet yourself."
            onClick={byHand}
          />
        </ul>
      </section>
      <footer className="footnote footnote--after">
        <span>MEXT 日本食品標準成分表（八訂）増補2023年, edited</span>
        <span className="footnote__formula">values per 100 g</span>
      </footer>
    </main>
  );
}

function Way({ name, meta, onClick }: { name: string; meta: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="ways__row" onClick={onClick}>
        <span className="ways__name">{name}</span>
        <span className="ways__meta">{meta}</span>
        <Chevron direction="forward" />
      </button>
    </li>
  );
}
