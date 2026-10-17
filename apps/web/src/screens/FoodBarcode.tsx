import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { barcodeDetector, isBarcode, spacedBarcode } from '../barcode';
import { AppBar, DataState, Notice, TextField } from '../components';
import { holdBarcode, holdCandidate, manualCandidate, valuesOf } from '../food';
import { goBack, type Navigate } from '../navigation';
import { foodsQuery, forAccount, useAccount } from '../query';

// Scan a barcode (docs/10 §8.6, the prototype's screen 19): the camera in a framed box, read on
// the device; the code goes to Open Food Facts through the API, and what it finds opens the check
// screen. A barcode already on the list opens that food instead (docs/09 F9 step 2). The number
// can also be typed, for a phone without a camera or one the user won't allow.

type Outcome =
  | { kind: 'scanning' }
  | { kind: 'looking'; code: string }
  | { kind: 'not-found'; code: string }
  | { kind: 'existing'; foodId: string }
  | { kind: 'down'; code: string; limited: boolean }
  | { kind: 'offline'; code: string };

const SCAN_EVERY_MS = 300;

export function FoodBarcode({ navigate }: { navigate: Navigate }) {
  const confirmed = useAccount().status === 'confirmed';
  const foods = useQuery({ ...foodsQuery, enabled: confirmed });
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'scanning' });
  const [camera, setCamera] = useState<'starting' | 'on' | 'none'>('starting');
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);
  const shown = useRef<HTMLDivElement>(null);
  const back = () => goBack(navigate, '/food/new');
  const scanning = outcome.kind === 'scanning';
  const settled = !scanning && outcome.kind !== 'looking';

  // The button pressed is gone once the outcome shows: focus moves to what it says.
  useEffect(() => {
    if (settled) shown.current?.focus();
  }, [settled]);

  const lookUp = async (code: string) => {
    setOutcome({ kind: 'looking', code });
    try {
      const result = await forAccount(() =>
        api.GET('/api/barcodes/{code}', { params: { path: { code } } }),
      );
      const { data, response } = result;
      if (data?.existingFoodId != null) {
        setOutcome({ kind: 'existing', foodId: data.existingFoodId });
        return;
      }
      if (data?.candidate != null) {
        const found = data.candidate;
        holdCandidate({
          source: 'open_food_facts',
          sourceRef: code,
          sourceLine: 'BARCODE · OPEN FOOD FACTS',
          name: found.name ?? '',
          brand: found.brand,
          state: found.state ?? 'raw',
          printed: { basis: found.basis, values: valuesOf(found) },
          per100g: data.per100g === null ? null : valuesOf(data.per100g),
          existingFoodId: null,
        });
        navigate('/food/new/check', { replace: true, returns: true });
        return;
      }
      if (response.status === 404) setOutcome({ kind: 'not-found', code });
      else setOutcome({ kind: 'down', code, limited: response.status === 429 });
    } catch {
      setOutcome({ kind: 'offline', code });
    }
  };

  // The camera runs while the screen is scanning, and stops on a find or on leaving.
  useEffect(() => {
    if (!scanning) return undefined;
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = async () => {
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        setCamera('none');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const element = video.current;
        if (stopped || element === null) return;
        element.srcObject = stream;
        await element.play();
        setCamera('on');
        const detector = await barcodeDetector();
        timer = setInterval(() => {
          if (stopped || element.readyState < 2) return;
          void detector
            .detect(element)
            .then((codes) => {
              const code = codes.map((each) => each.rawValue).find(isBarcode);
              if (code !== undefined && !stopped) {
                stopped = true;
                void lookUp(code);
              }
            })
            .catch(() => undefined);
        }, SCAN_EVERY_MS);
      } catch {
        if (!stopped) setCamera('none');
      }
    };
    void start();
    return () => {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
    // lookUp reads only state setters and navigate, which keep their identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const photographLabel = (code: string | null) => {
    holdBarcode(code);
    navigate('/food/new/label', { replace: true, returns: true });
  };
  const byHand = (code: string | null) => {
    holdCandidate(manualCandidate(code));
    navigate('/food/new/check', { replace: true, returns: true });
  };
  const existingName =
    outcome.kind === 'existing'
      ? foods.data?.find((food) => food.id === outcome.foodId)?.name
      : undefined;

  return (
    <main>
      <AppBar
        title="Scan a barcode"
        slot={<DataState at={0} />}
        back={{ label: 'Back to adding a food', onClick: back }}
      />
      {(scanning || outcome.kind === 'looking') && (
        <>
          <div className="viewfinder">
            <video ref={video} className="viewfinder__video" muted playsInline aria-hidden="true" />
            <span className="viewfinder__frame" aria-hidden="true" />
          </div>
          <p className="viewfinder__caption">
            {camera === 'none'
              ? 'No camera, or it wasn’t allowed. Type the number below.'
              : 'Hold the barcode inside the frame'}
          </p>
          {outcome.kind === 'looking' && (
            <output className="food-status">
              Looking up {spacedBarcode(outcome.code)} in Open Food Facts…
            </output>
          )}
          <form
            className="form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const code = typed.replace(/\s/g, '');
              if (!isBarcode(code)) {
                setTypedError('The 8 to 14 digits under the bars');
                return;
              }
              setTypedError(undefined);
              void lookUp(code);
            }}
          >
            <TextField
              label="Or type the number"
              value={typed}
              onChange={setTyped}
              placeholder="4901234567894"
              inputMode="numeric"
              error={typedError}
            />
            <div className="section-actions section-actions--flush">
              <button
                type="submit"
                className="button button--secondary"
                disabled={outcome.kind === 'looking'}
              >
                Look it up
              </button>
            </div>
          </form>
        </>
      )}

      <div ref={shown} tabIndex={-1} hidden={!settled}>
        {outcome.kind === 'not-found' && (
          <section className="empty-state" aria-labelledby="not-found">
            <h2 id="not-found" className="empty-state__title">
              Not in Open Food Facts
            </h2>
            <p className="empty-state__body">
              Barcode {spacedBarcode(outcome.code)} isn’t in the database. The label has the
              numbers.
            </p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => photographLabel(outcome.code)}
            >
              Photograph the label
            </button>
            <button
              type="button"
              className="button button--tertiary"
              onClick={() => byHand(outcome.code)}
            >
              Enter it by hand
            </button>
          </section>
        )}

        {outcome.kind === 'existing' && (
          <section className="empty-state" aria-labelledby="existing">
            <h2 id="existing" className="empty-state__title">
              Already on your list
            </h2>
            <p className="empty-state__body">
              {existingName ?? 'A food on your list'} has this barcode. Nothing new was made.
            </p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => navigate(`/food/${outcome.foodId}`, { replace: true, returns: true })}
            >
              Open {existingName ?? 'it'}
            </button>
          </section>
        )}

        {(outcome.kind === 'down' || outcome.kind === 'offline') && (
          <>
            <Notice
              tone="flag"
              word={
                outcome.kind === 'offline' ? 'Not looked up' : 'Open Food Facts isn’t answering'
              }
            >
              {outcome.kind === 'offline'
                ? 'Couldn’t reach Overload. Try again when you have signal, or carry on without it.'
                : outcome.limited
                  ? 'It is limiting lookups for a minute. Try again shortly, or carry on without it.'
                  : 'Try again in a minute, or carry on without it.'}
            </Notice>
            <div className="section-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => photographLabel(outcome.code)}
              >
                Photograph the label
              </button>
              <button
                type="button"
                className="button button--tertiary"
                onClick={() => byHand(outcome.code)}
              >
                Enter it by hand
              </button>
              <button
                type="button"
                className="button button--tertiary"
                onClick={() => setOutcome({ kind: 'scanning' })}
              >
                Scan again
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
