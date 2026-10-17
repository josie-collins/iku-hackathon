import { useCallback, useEffect, useState } from 'react';
import { api, formatMoney } from './api';

const CURRENT = ['on_trip'];
const PLANNED = ['planning', 'voting', 'resolving', 'booked'];
const PAST = ['settled'];

const STATUS_LABELS = {
  planning: 'Planning',
  voting: 'Voting',
  resolving: 'Finding options',
  booked: 'Booked',
  on_trip: 'On the trip',
  settled: 'Settled',
};

const BUDGET_FIELDS = [
  { key: 'flight_minor', label: 'Flights', hint: 'Your own flight there and back' },
  { key: 'group_minor', label: 'Group budget', hint: 'Stay and shared activities, whole trip' },
  { key: 'private_daily_minor', label: 'Private, per day', hint: 'Food, extras, personal spending' },
];

function formatDates(start, end) {
  if (!start) return 'Dates not set yet';
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return end ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}

export default function Account({ onLogOut }) {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api('/account')
      .then(setAccount)
      .catch((err) => {
        if (err.message === 'unauthenticated') onLogOut();
        else setError(err.message);
      });
  }, [onLogOut]);

  useEffect(load, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!account) return <p>Loading…</p>;

  const { user, trips } = account;
  const section = (title, statuses, empty) => {
    const list = trips.filter((t) => statuses.includes(t.status));
    return (
      <section>
        <h2>{title}</h2>
        {list.length ? (
          list.map((trip) => <TripCard key={trip.group_id} trip={trip} currency={user.home_currency} onSaved={load} />)
        ) : (
          <p className="muted">{empty}</p>
        )}
      </section>
    );
  };

  return (
    <>
      <section className="card profile">
        <div>
          <h2>{user.name}</h2>
          <p className="muted">
            {[user.home_currency, user.departure_airport && `flies from ${user.departure_airport}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button className="secondary" onClick={onLogOut}>Log out</button>
      </section>

      {section('Current trips', CURRENT, "You're not on a trip right now.")}
      {section('Planned trips', PLANNED, 'No trips being planned.')}
      {section('Past trips', PAST, 'No past trips yet.')}
    </>
  );
}

function TripCard({ trip, currency, onSaved }) {
  const [editing, setEditing] = useState(false);
  const canEdit = !PAST.includes(trip.status);
  const budgetCurrency = trip.budget?.currency || currency;

  return (
    <article className="card trip">
      <header>
        <h3>{trip.name}</h3>
        <span className={`status status-${trip.status}`}>{STATUS_LABELS[trip.status] || trip.status}</span>
      </header>
      <p className="muted">
        {trip.city || 'Destination not chosen yet'} · {formatDates(trip.trip_start, trip.trip_end)} · {trip.member_count} people
        {trip.role === 'organiser' && ' · you organise'}
      </p>

      <h4>Your private budget</h4>
      <p className="muted small">Only you can see these numbers.</p>
      {editing ? (
        <BudgetForm
          trip={trip}
          currency={budgetCurrency}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      ) : (
        <>
          {trip.budget ? (
            <dl className="budget">
              {BUDGET_FIELDS.map((f) => (
                <div key={f.key} className="budget-row">
                  <dt>{f.label}</dt>
                  <dd>{formatMoney(trip.budget[f.key], budgetCurrency)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>You haven't entered a budget yet.</p>
          )}
          {canEdit && (
            <button className="secondary" onClick={() => setEditing(true)}>
              {trip.budget ? 'Edit budget' : 'Add budget'}
            </button>
          )}
        </>
      )}
    </article>
  );
}

function BudgetForm({ trip, currency, onCancel, onSaved }) {
  // The inputs hold major units (e.g. "250.00"); the API takes minor units.
  const [values, setValues] = useState(() =>
    Object.fromEntries(BUDGET_FIELDS.map((f) => [f.key, trip.budget ? String(Number(trip.budget[f.key]) / 100) : '']))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const body = {};
    for (const f of BUDGET_FIELDS) {
      const amount = Number(values[f.key]);
      if (values[f.key] === '' || !Number.isFinite(amount) || amount < 0) {
        return setError(`Enter an amount of 0 or more for ${f.label.toLowerCase()}.`);
      }
      body[f.key] = Math.round(amount * 100);
    }
    setSaving(true);
    setError('');
    try {
      await api(`/budgets/${trip.group_id}`, { method: 'PUT', body });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form className="budget-form" onSubmit={submit}>
      {BUDGET_FIELDS.map((f) => (
        <label key={f.key}>
          <span>{f.label} ({currency})</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={values[f.key]}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
          <small className="muted">{f.hint}</small>
        </label>
      ))}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
