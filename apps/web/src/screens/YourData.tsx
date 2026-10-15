import type { Me } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { authClient } from '../auth-client';
import { AppBar, DataState, Notice, TextField } from '../components';
import {
  exportAccountIsCurrent,
  exportFileName,
  readExport,
  saveExport,
  SECTION_COUNT,
} from '../export';
import { goBack, type Navigate } from '../navigation';
import { markSigningIn, meQuery, takeSigningIn, useAccount } from '../query';
import { deleteAccount, type DeleteAccountResult } from '../sign-out';
import { deviceTimezone } from '../timezones';
import { useWorkoutStore, readFailedFor, recordsLoadedFor, recordsOf } from '../workout';
import { requestUpload } from '../uploader';

// Export and delete (S10, docs/09 F7). No artboard draws it (docs/10 §8): it is built from docs/05's
// tokens and the profile form's blocks.

/** Better Auth's `freshAge`: deletion needs a session made within the last day (docs/08 §6). */
const FRESH_MS = 24 * 60 * 60 * 1000;

export function YourData({ me, navigate }: { me: Me; navigate: Navigate }) {
  const timeZone = me.profile?.timezone ?? deviceTimezone();
  const checked = useQuery(meQuery).dataUpdatedAt;
  return (
    <main>
      <AppBar
        title="Your data"
        slot={<DataState at={checked} />}
        back={{ label: 'Back', onClick: () => goBack(navigate, '/') }}
      />
      <ExportBlock timeZone={timeZone} userId={me.user.id} />
      <DeleteBlock me={me} navigate={navigate} />
    </main>
  );
}

/** Pages through every section and saves the file (docs/09 F7 step 1). */
function ExportBlock({ timeZone, userId }: { timeZone: string; userId: string }) {
  const [reading, setReading] = useState<number>();
  const [saved, setSaved] = useState<string>();
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = async () => {
    setReading(0);
    setSaved(undefined);
    setFailed(false);
    try {
      const file = await readExport(userId, setReading);
      if (!mounted.current) return;
      if (!exportAccountIsCurrent(userId)) throw new Error('Export account changed');
      const name = exportFileName(timeZone);
      saveExport(file, name);
      setSaved(name);
    } catch {
      if (mounted.current) setFailed(true);
    }
    if (mounted.current) setReading(undefined);
  };

  return (
    <section className="form" aria-labelledby="export-heading">
      <h2 id="export-heading" className="section-label">
        Export
      </h2>
      <p className="form__lede">
        Everything you have logged, in one JSON file: your profile, exercises and their settings,
        routines, and every workout with its sets.
      </p>
      {failed && (
        <Notice tone="flag" word="Not exported">
          Couldn’t reach Overload. Try again when you have signal.
        </Notice>
      )}
      <button
        type="button"
        className="button button--secondary"
        disabled={reading !== undefined}
        onClick={() => void run()}
      >
        {reading === undefined
          ? 'Export your data'
          : `Exporting… ${reading + 1} of ${SECTION_COUNT}`}
      </button>
      {saved !== undefined && <output className="form__lede">Saved {saved}.</output>}
    </section>
  );
}

type Freshness = 'checking' | 'fresh' | 'stale';

/** Why the delete stopped: the delete's own reasons, or an upload asked for that did not finish. */
type Stop = Exclude<DeleteAccountResult, 'deleted'> | 'upload-failed';

/** Whether this session is young enough to delete with, by Better Auth's own `createdAt`. */
function useFreshness(): [Freshness, (next: Freshness) => void] {
  const [freshness, setFreshness] = useState<Freshness>('checking');
  useEffect(() => {
    let current = true;
    void authClient
      .getSession()
      .then((result) => {
        const createdAt = result.data?.session.createdAt;
        if (!current) return;
        setFreshness(
          createdAt === undefined || Date.now() - new Date(createdAt).getTime() < FRESH_MS
            ? 'fresh'
            : 'stale',
        );
      })
      // Unknown: the form is offered, and the server's own check answers.
      .catch(() => {
        if (current) setFreshness('fresh');
      });
    return () => {
      current = false;
    };
  }, []);
  return [freshness, setFreshness];
}

/** Deletes the account after a fresh sign-in and a typed `DELETE` (docs/09 F7 steps 2 to 4). */
function DeleteBlock({ me, navigate }: { me: Me; navigate: Navigate }) {
  const [freshness, setFreshness] = useFreshness();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState<Stop>();
  const [signingIn, setSigningIn] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const { userId } = useAccount();
  const loading = useWorkoutStore(
    (state) => !recordsLoadedFor(state, userId) && !readFailedFor(state, userId),
  );
  // Sets the server has not acknowledged, refused ones included (docs/08 §7).
  const waiting = useWorkoutStore(
    (state) =>
      recordsOf(state, userId).filter(
        (record) =>
          record.table === 'sets' &&
          record.deletedAt === undefined &&
          record.state !== 'acknowledged',
      ).length,
  );
  // The answer replaces the button pressed; focus follows it there.
  const answer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stopped !== undefined) answer.current?.focus();
  }, [stopped]);

  const remove = (options: { discard?: boolean } = {}) => {
    setBusy(true);
    setStopped(undefined);
    void deleteAccount(navigate, me.user.id, options)
      .catch((): DeleteAccountResult => 'unknown-outcome')
      .then((result) => {
        if (result === 'deleted') return;
        if (result === 'stale-session') setFreshness('stale');
        setBusy(false);
        setStopped(result);
      });
  };
  // Uploads only: what is uploaded can then be exported before the account goes.
  const upload = () => {
    setBusy(true);
    void requestUpload()
      .then(() => {
        const state = useWorkoutStore.getState();
        setStopped(
          recordsLoadedFor(state, me.user.id) &&
            recordsOf(state, me.user.id).every((record) => record.state === 'acknowledged')
            ? undefined
            : 'upload-failed',
        );
      })
      .catch(() => setStopped('upload-failed'))
      .finally(() => setBusy(false));
  };

  const signInAgain = async () => {
    setSigningIn(true);
    setSignInFailed(false);
    markSigningIn();
    const result = await authClient.signIn
      .social({ provider: 'google', callbackURL: '/account', errorCallbackURL: '/sign-in' })
      .catch(() => ({ error: true }));
    // On success the browser is already leaving for Google.
    if (result.error) {
      takeSigningIn();
      setSigningIn(false);
      setSignInFailed(true);
    }
  };

  const heading = (
    <h2 id="delete-heading" className="section-label">
      Delete account
    </h2>
  );

  if (me.isAdmin) {
    return (
      <section className="form form--secondary" aria-labelledby="delete-heading">
        {heading}
        <p className="form__lede">
          This is the admin account, so it can’t be deleted. Name another admin first.
        </p>
      </section>
    );
  }

  if (freshness === 'stale') {
    return (
      <section className="form form--secondary" aria-labelledby="delete-heading">
        {heading}
        <p className="form__lede">
          To delete your account, sign in with Google again first. It confirms it is you, and brings
          you back here.
        </p>
        {signInFailed && (
          <Notice tone="flag" word="Not signed in">
            Sign-in didn’t finish. Check your connection and try again.
          </Notice>
        )}
        <button
          type="button"
          className="button button--secondary"
          disabled={signingIn}
          onClick={() => void signInAgain()}
        >
          {signingIn ? 'Opening Google…' : 'Sign in with Google again'}
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="delete-heading">
      <form
        className="form form--secondary"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && typed === 'DELETE') remove();
        }}
      >
        {heading}
        <p className="form__lede">
          This deletes your account and everything in it: your profile, exercises, routines,
          workouts and sets. Your invite goes too, so coming back takes a new one. It can’t be
          undone. Export your data first to keep a copy.
        </p>
        <p className="form__lede">
          Two things outlast it: access records (ids, times, IP address and browser, no content) are
          kept for one year, and backups holding your data expire within 30 days.
        </p>
        <TextField label="Type DELETE to confirm" value={typed} onChange={setTyped} literal />
        <div ref={answer} tabIndex={-1} className="delete-answer">
          <Stopped
            stopped={stopped}
            waiting={waiting}
            busy={busy}
            remove={remove}
            upload={upload}
          />
        </div>
        <button
          type="submit"
          className="button button--secondary"
          disabled={busy || loading || freshness === 'checking' || typed !== 'DELETE'}
        >
          {busy ? 'Deleting…' : 'Delete account'}
        </button>
      </form>
    </section>
  );
}

/** Why the delete stopped, and what can be done about it, as sign-out says it (docs/08 §7). */
function Stopped({
  stopped,
  waiting,
  busy,
  remove,
  upload,
}: {
  stopped: Stop | undefined;
  waiting: number;
  busy: boolean;
  remove: (options?: { discard?: boolean }) => void;
  upload: () => void;
}) {
  if (stopped === undefined || stopped === 'stale-session') return null;
  if (stopped === 'failed') {
    return (
      <Notice tone="flag" word="Not deleted">
        Couldn’t check the account or pending workouts. Deletion was not started. Reload and try
        again.
      </Notice>
    );
  }
  if (stopped === 'account-changed') {
    return (
      <Notice tone="flag" word="Account changed">
        The signed-in account changed. Reload this page before deleting.
      </Notice>
    );
  }
  if (stopped === 'unknown-outcome') {
    return (
      <Notice tone="flag" word="Check account">
        Couldn’t confirm whether your account was deleted. Reload to check.
      </Notice>
    );
  }
  if (stopped === 'refused') {
    return (
      <Notice tone="flag" word="Not deleted">
        Overload refused the deletion. Nothing was deleted. Reload and try again.
      </Notice>
    );
  }
  if (stopped === 'upload-failed') {
    return (
      <Notice tone="flag" word="Upload incomplete">
        Couldn’t confirm the upload finished. Some workout data may have uploaded. Your account was
        not deleted. Check your connection and try again.
      </Notice>
    );
  }
  if (stopped === 'admin-account') {
    return (
      <Notice tone="error" word="Refused">
        The admin account can’t be deleted.
      </Notice>
    );
  }
  if (stopped === 'workout-open') {
    return (
      <Notice tone="flag" word="Not deleted">
        A workout is in progress. Finish it first.
      </Notice>
    );
  }
  if (stopped === 'workout-unsynced') {
    return (
      <fieldset className="confirm">
        <legend className="confirm__question">
          Your workout has not finished uploading. It has to reach the server first.
        </legend>
        <div className="confirm__actions">
          <button
            type="button"
            className="button button--tertiary"
            disabled={busy}
            onClick={upload}
          >
            Try again
          </button>
        </div>
      </fieldset>
    );
  }
  return (
    <fieldset className="confirm">
      <legend className="confirm__question">
        {waiting === 0
          ? 'Your workout is not uploaded yet.'
          : `${waiting} ${waiting === 1 ? 'set' : 'sets'} not uploaded yet.`}{' '}
        Deleting doesn’t upload them. Upload them now to keep them in an export, or discard them and
        delete.
      </legend>
      <div className="confirm__actions">
        <button type="button" className="button button--tertiary" disabled={busy} onClick={upload}>
          Upload now
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={busy}
          onClick={() => remove({ discard: true })}
        >
          Discard and delete
        </button>
      </div>
    </fieldset>
  );
}
