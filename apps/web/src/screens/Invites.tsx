import type { Invite, Me } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, unwrap } from '../api';
import { AppBar, DataState, DeleteConfirm, Notice, TextField } from '../components';
import { dayLabel } from '../dates';
import { newId } from '../ids';
import { goBack, type Navigate } from '../navigation';
import { forAccount, invitesQuery, refreshInvites, useAccount } from '../query';
import {
  saveProblem,
  SaveNotice,
  useFocusRefused,
  type RequestProblem,
  type SaveProblem,
} from '../saving';
import { deviceTimezone } from '../timezones';

// Invite administration (S9, docs/09 F6). No artboard draws it (docs/10 §8): it is built from
// docs/05's tokens and the routine list's rows. The admin sees each invite's email, note and dates,
// and nothing about what its member has logged (docs/08 §4).

export function Invites({ me, navigate }: { me: Me; navigate: Navigate }) {
  const confirmed = useAccount().status === 'confirmed';
  const invites = useQuery({ ...invitesQuery, enabled: confirmed });
  const timeZone = me.profile?.timezone ?? deviceTimezone();
  const items = invites.data ?? [];
  const others = items.filter((invite) => invite.email !== me.user.email.toLowerCase());
  const revoked = others.filter((invite) => invite.revokedAt !== null).length;

  return (
    <main>
      <AppBar
        title="Invites"
        subline={
          invites.data === undefined
            ? undefined
            : `${others.length - revoked} ACTIVE · ${revoked} REVOKED`
        }
        slot={<DataState at={invites.dataUpdatedAt} />}
        back={{ label: 'Back', onClick: () => goBack(navigate, '/') }}
      />

      <AddInvite />

      {invites.isError && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {invites.data === undefined
            ? 'Try again when you have signal.'
            : 'Showing the last copy.'}
        </Notice>
      )}

      {invites.data !== undefined && (
        <section className="invites-section" aria-labelledby="invites-heading">
          <h2 id="invites-heading" className="section-label section-label--gutter">
            Invited
          </h2>
          {others.length === 0 && <p className="empty">Only you have access.</p>}
          {others.length > 0 && (
            <ul className="invites">
              {others.map((invite) => (
                <InviteRow key={invite.id} invite={invite} timeZone={timeZone} />
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

/** Adds an invite (docs/09 F6 step 2). Overload sends no email: the admin tells the person. */
function AddInvite() {
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  // One id per invite being typed, so a retried add lands once (docs/07 §1.2).
  const [id, setId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const [added, setAdded] = useState<string>();
  const form = useFocusRefused(problem);

  const emailError = (): string | undefined => {
    if (problem?.kind !== 'refused') return undefined;
    if (problem.code === 'invite_exists') return 'Already invited. Restore it below if revoked';
    return problem.fields.has('email') ? 'Enter a Google email address' : undefined;
  };

  const add = async () => {
    setBusy(true);
    setProblem(undefined);
    setAdded(undefined);
    try {
      const invite = await forAccount(async () =>
        unwrap(
          await api.POST('/api/admin/invites', {
            body: { id, email: email.trim(), note: note.trim() === '' ? null : note.trim() },
          }),
        ),
      );
      await refreshInvites();
      setAdded(invite.email);
      setEmail('');
      setNote('');
      setId(newId());
    } catch (error) {
      setProblem(saveProblem(error));
    }
    setBusy(false);
  };

  return (
    <>
      <SaveNotice problem={problem} what="invite" />
      <form
        ref={form}
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void add();
        }}
      >
        <TextField
          label="Google email"
          type="email"
          value={email}
          onChange={setEmail}
          error={emailError()}
          placeholder="name@gmail.com"
        />
        <TextField
          label="Note"
          note="Optional"
          value={note}
          onChange={setNote}
          placeholder="Gym friend…"
        />
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add invite'}
        </button>
        <output className="form__lede">
          {added === undefined
            ? 'Overload sends no email. Tell them yourself once they are added.'
            : `${added} can sign in now. Tell them yourself: Overload sends no email.`}
        </output>
      </form>
    </>
  );
}

/** One invite: its email, note and dates, and Revoke or Restore (docs/09 F6 steps 3 and 4). */
function InviteRow({ invite, timeZone }: { invite: Invite; timeZone: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<RequestProblem>();
  const isRevoked = invite.revokedAt !== null;
  // After a revoke or restore the button pressed is gone; focus goes to the one that replaced it.
  const row = useRef<HTMLLIElement>(null);
  const focusPending = useRef(false);
  useEffect(() => {
    if (!focusPending.current || busy) return;
    focusPending.current = false;
    row.current?.querySelector<HTMLElement>('.invites__action button')?.focus();
  });

  const act = async (action: 'revoke' | 'restore') => {
    focusPending.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      const params = { path: { id: invite.id } };
      await forAccount(async () =>
        unwrap(
          action === 'revoke'
            ? await api.POST('/api/admin/invites/{id}/revoke', { params })
            : await api.POST('/api/admin/invites/{id}/restore', { params }),
        ),
      );
      await refreshInvites();
    } catch (error) {
      focusPending.current = false;
      setProblem(saveProblem(error));
    }
    setBusy(false);
  };
  const which = <span className="visually-hidden"> {invite.email}</span>;

  return (
    <li ref={row} className="invites__row">
      <div className="invites__text">
        <span className="invites__email">{invite.email}</span>
        <span className="invites__meta">
          {isRevoked && (
            <>
              <span className="invites__revoked">Revoked</span>{' '}
              {dayLabel(invite.revokedAt ?? invite.invitedAt, timeZone).toUpperCase()} ·{' '}
            </>
          )}
          INVITED {dayLabel(invite.invitedAt, timeZone).toUpperCase()}
        </span>
        {invite.note !== null && <span className="invites__note">{invite.note}</span>}
      </div>
      {problem !== undefined && <RowProblem problem={problem} />}
      <div className="invites__action">
        {isRevoked ? (
          <button
            type="button"
            className="button button--secondary"
            disabled={busy}
            onClick={() => void act('restore')}
          >
            {busy ? 'Restoring…' : 'Restore'}
            {which}
          </button>
        ) : (
          <DeleteConfirm
            label={<>Revoke{which}</>}
            question={`Revoke ${invite.email}? They are signed out everywhere and can’t sign in again. Their data stays, and Restore brings it back.`}
            keepLabel="Keep"
            confirmLabel="Revoke"
            busy={busy}
            onDelete={() => void act('revoke')}
          />
        )}
      </div>
    </li>
  );
}

function RowProblem({ problem }: { problem: RequestProblem }) {
  if (problem.kind === 'unreached') {
    return (
      <Notice tone="flag" word="Not saved">
        Couldn’t reach Overload. Try again when you have signal.
      </Notice>
    );
  }
  const reason =
    problem.code === 'admin_account'
      ? 'Your own invite can’t be revoked.'
      : problem.code === 'not_found'
        ? 'This invite no longer exists.'
        : 'Nothing was changed.';
  return (
    <Notice tone="error" word="Refused">
      {reason}
    </Notice>
  );
}
