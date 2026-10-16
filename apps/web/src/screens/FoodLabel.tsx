import { useRef, useState } from 'react';
import { api } from '../api';
import { AppBar, DataState, Notice } from '../components';
import { holdCandidate, manualCandidate, useCandidateStore, valuesOf } from '../food';
import { goBack, type Navigate } from '../navigation';
import { forAccount } from '../query';

// Photograph the label (docs/10 §8.6, the prototype's screen 20): the photo of the 栄養成分表示 is
// resized on the phone (docs/07 §1.5), read once by the API's model call and kept nowhere, and what
// was read opens the check screen with its basis. The daily cap and an unreadable photo each say
// so, with the way on by hand.

/** The long edge the API wants (docs/07 §1.5), as JPEG. */
const LONG_EDGE = 1568;
const QUALITY = 0.85;

type Outcome =
  | { kind: 'aim' }
  | { kind: 'reading' }
  | { kind: 'unreadable' }
  | { kind: 'cap' }
  | { kind: 'down' }
  | { kind: 'offline' }
  | { kind: 'too-large' };

/** The photo at most 1568 px on its long edge, as JPEG. A HEIC photo is decoded by the browser. */
async function resized(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    if (blob === null) throw new Error('Could not encode the photo');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const readTime = () =>
  new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function FoodLabel({ navigate }: { navigate: Navigate }) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'aim' });
  const input = useRef<HTMLInputElement>(null);
  // A barcode scanned before and not found stays the food's key (docs/07 §4's example).
  const [barcode] = useState(() => useCandidateStore.getState().barcode);
  const back = () => goBack(navigate, '/food/new');

  const read = async (file: File) => {
    setOutcome({ kind: 'reading' });
    let photo: Blob;
    try {
      photo = await resized(file);
    } catch {
      setOutcome({ kind: 'unreadable' });
      return;
    }
    const form = new FormData();
    form.append('image', photo, 'label.jpg');
    try {
      const { data, response } = await forAccount(() =>
        api.POST('/api/label-reads', {
          // The body is the multipart form; the typed placeholder only satisfies the contract.
          body: { image: '' },
          bodySerializer: () => form,
        }),
      );
      if (data !== undefined) {
        const found = data.candidate;
        holdCandidate({
          source: 'label_photo',
          sourceRef: barcode,
          sourceLine: `LABEL PHOTO · READ ${readTime()}`,
          name: found.name ?? '',
          brand: found.brand,
          state: found.state ?? 'raw',
          printed: { basis: found.basis, values: valuesOf(found) },
          per100g:
            data.per100g === null
              ? { energyKcal: null, proteinG: null, carbG: null, fatG: null, fiberG: null }
              : valuesOf(data.per100g),
          existingFoodId: null,
        });
        navigate('/food/new/check', { replace: true, returns: true });
        return;
      }
      if (response.status === 422) setOutcome({ kind: 'unreadable' });
      else if (response.status === 429) setOutcome({ kind: 'cap' });
      else if (response.status === 413) setOutcome({ kind: 'too-large' });
      else setOutcome({ kind: 'down' });
    } catch {
      setOutcome({ kind: 'offline' });
    }
  };

  const byHand = () => {
    holdCandidate(manualCandidate(barcode));
    navigate('/food/new/check', { replace: true, returns: true });
  };
  const takePhoto = () => {
    if (input.current !== null) input.current.value = '';
    input.current?.click();
  };

  return (
    <main>
      <AppBar
        title="Photograph the label"
        slot={<DataState at={0} />}
        back={{ label: 'Back to adding a food', onClick: back }}
      />
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void read(file);
        }}
      />
      {(outcome.kind === 'aim' || outcome.kind === 'reading') && (
        <>
          <div className="viewfinder viewfinder--label" aria-hidden="true">
            <span className="viewfinder__frame" />
            <span className="viewfinder__caption">
              {outcome.kind === 'reading'
                ? 'Reading the label…'
                : 'Fill the frame with the 栄養成分表示'}
            </span>
          </div>
          {outcome.kind === 'reading' ? (
            <output className="food-status">Reading the label. This takes a few seconds.</output>
          ) : (
            <>
              <p className="food-hint food-hint--gutter">
                Flat, in good light, every line in view. The photo is read once and not kept.
              </p>
              <div className="section-actions">
                <button type="button" className="button button--primary" onClick={takePhoto}>
                  Take the photo
                </button>
              </div>
            </>
          )}
        </>
      )}
      {outcome.kind === 'unreadable' && (
        <section className="empty-state" aria-labelledby="unreadable">
          <h2 id="unreadable" className="empty-state__title">
            Couldn’t read the label
          </h2>
          <p className="empty-state__body">
            The photo was blurred or cut off. Try again closer and flatter, or type the numbers.
          </p>
          <button type="button" className="button button--primary" onClick={takePhoto}>
            Retake
          </button>
          <button type="button" className="button button--tertiary" onClick={byHand}>
            Enter it by hand
          </button>
        </section>
      )}
      {outcome.kind !== 'aim' && outcome.kind !== 'reading' && outcome.kind !== 'unreadable' && (
        <>
          <Notice tone="flag" word={WORDS[outcome.kind].word}>
            {WORDS[outcome.kind].body}
          </Notice>
          <div className="section-actions">
            <button type="button" className="button button--primary" onClick={byHand}>
              {outcome.kind === 'cap' ? 'Enter it by hand' : 'Continue by hand'}
            </button>
            {outcome.kind !== 'cap' && (
              <button type="button" className="button button--tertiary" onClick={takePhoto}>
                Try another photo
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}

const WORDS = {
  cap: {
    word: 'Photo reads used up for today',
    body: 'Label reading has a daily limit. Typing the numbers works now, and reading comes back tomorrow.',
  },
  down: {
    word: 'The reader isn’t answering',
    body: 'Nothing was read. Type the numbers from the label, or try again in a minute.',
  },
  offline: {
    word: 'Not read',
    body: 'Couldn’t reach Overload. Type the numbers, or try again when you have signal.',
  },
  'too-large': {
    word: 'Photo too large',
    body: 'The photo should have been made smaller before sending. Try another, or type the numbers.',
  },
} as const;
