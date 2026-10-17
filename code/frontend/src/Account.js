import { useCallback, useEffect, useState } from 'react';
import { api, formatMoney } from './api';
import Friends from './Friends';
import Trip from './Trip';

const CURRENT = ['on_trip'];
const PLANNED = ['planning', 'voting', 'resolving', 'booked'];
const PAST = ['settled'];
// Before booking: the shortlist is live and members can still drop out.
const OPEN = ['planning', 'voting', 'resolving'];

const STATUS_LABELS = {
  planning: 'Waiting for details',
  voting: 'Options ready',
  resolving: 'No match yet',
  booked: 'Booked',
  on_trip: 'On the trip',
  settled: 'Settled',
};

const BUDGET_FIELDS = [
  { key: 'flight_minor', label: 'Flights', hint: 'Your own flight there and back' },
  { key: 'group_minor', label: 'Group budget', hint: 'Stay and shared activities, whole trip' },
  { key: 'private_daily_minor', label: 'Private, per day', hint: 'Food, extras, personal spending' },
];

const formatDate = (d) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const nightsBetween = (start, end) => Math.round((new Date(end) - new Date(start)) / 86400000);

function formatDates(start, end) {
  if (!start) return 'Dates not set yet';
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

// "Day trip", "2 nights", ... from a trip's dates
function tripLength(start, end) {
  if (!start) return null;
  const nights = end ? nightsBetween(start, end) : 0;
  if (nights === 0) return 'Day trip';
  return nights === 1 ? '1 night' : `${nights} nights`;
}

export default function Account({ onLogOut }) {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('trips'); // 'trips' | 'friends'
  const [creating, setCreating] = useState(false);
  const [openTrip, setOpenTrip] = useState(null); // group id of the trip page being shown

  const load = useCallback(() => {
    api('/account')
      .then(setAccount)
      .catch((err) => {
        if (err.message === 'unauthenticated') onLogOut();
        else setError(err.message);
      });
  }, [onLogOut]);

  useEffect(load, [load]);

  if (error) {
    return (
      <section className="card">
        <p className="error">Couldn't load your account: {error}</p>
        <button className="secondary" onClick={onLogOut}>Log out</button>
      </section>
    );
  }
  if (!account) return <p>Loading…</p>;

  if (openTrip) {
    return (
      <Trip
        groupId={openTrip}
        onLogOut={onLogOut}
        onBack={() => {
          setOpenTrip(null);
          load();
        }}
      />
    );
  }

  const { user, trips } = account;
  const section = (title, statuses, empty) => {
    const list = trips.filter((t) => statuses.includes(t.status));
    return (
      <section>
        <h2>{title}</h2>
        {list.length ? (
          list.map((trip) => <TripCard key={trip.group_id} trip={trip} user={user} onChanged={load} onOpen={() => setOpenTrip(trip.group_id)} />)
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
            {[`@${user.username}`, user.home_currency, user.departure_airport && `flies from ${user.departure_airport}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <button className="secondary" onClick={onLogOut}>Log out</button>
      </section>

      <nav className="tabs" role="tablist">
        {[['trips', 'Trips'], ['friends', 'Friends']].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'trips' ? (
        <>
          {creating ? (
            <NewTrip
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                load();
              }}
              onFindFriends={() => setTab('friends')}
            />
          ) : (
            <button className="new-trip" onClick={() => setCreating(true)}>+ Plan a new trip</button>
          )}
          {section('Current trips', CURRENT, "You're not on a trip right now.")}
          {section('Planned trips', PLANNED, 'No trips being planned.')}
          {section('Past trips', PAST, 'No past trips yet.')}
        </>
      ) : (
        <Friends onLogOut={onLogOut} />
      )}
    </>
  );
}

function NewTrip({ onCancel, onCreated, onFindFriends }) {
  const [friends, setFriends] = useState(null);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/friends').then((d) => setFriends(d.friends)).catch((err) => setError(err.message));
  }, []);

  const toggle = (id) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/trips', { method: 'POST', body: { name, friendIds: [...picked] } });
      onCreated();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 className="card-title">Plan a new trip</h2>
      <label>
        <span>Trip name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer 2027" required />
      </label>
      <fieldset className="friend-picker">
        <legend>Who's going?</legend>
        {friends === null && !error && <p className="muted">Loading friends…</p>}
        {friends?.length === 0 && (
          <p className="muted">
            Add friends first.{' '}
            <button type="button" className="link" onClick={onFindFriends}>Go to Friends</button>
          </p>
        )}
        {friends?.map((f) => (
          <label key={f.id} className="check">
            <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} />
            <span>
              {f.name} <span className="muted">@{f.username}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {picked.size === 1 && (
        <p className="warning">
          In a group of two, your friend can roughly work out your budget from the options shown.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={saving || !name.trim() || !picked.size}>
          {saving ? 'Creating…' : 'Create trip'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function TripCard({ trip, user, onChanged, onOpen }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const isOpen = OPEN.includes(trip.status);
  const canEdit = !PAST.includes(trip.status);
  const budgetCurrency = trip.budget?.currency || user.home_currency;
  const others = trip.members.filter((m) => m.user_id !== user.id);

  const leave = async () => {
    if (!window.confirm(`Drop out of ${trip.name}? Your budget and dates for this trip will be deleted.`)) return;
    try {
      await api(`/trips/${trip.group_id}/membership`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <article className="card trip">
      <header>
        <h3>{trip.name}</h3>
        <span className={`status status-${trip.status}`}>{STATUS_LABELS[trip.status] || trip.status}</span>
      </header>
      <p className="muted">
        {[
          trip.city || 'Destination not chosen yet',
          formatDates(trip.trip_start, trip.trip_end),
          tripLength(trip.trip_start, trip.trip_end),
          trip.role === 'organiser' && 'you organise',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="muted small">
        With {others.length ? others.map((m) => m.name).join(', ') : 'nobody else yet'}
      </p>

      {isOpen && <GroupProgress trip={trip} />}
      {!isOpen && (
        <button className="open-trip" onClick={onOpen}>
          {trip.status === 'settled' ? 'Expenses and payments' : 'Expenses'} →
        </button>
      )}

      <h4>Your private details</h4>
      <p className="muted small">Only you can see these. The group only sees what fits everyone.</p>
      {editing ? (
        <BudgetForm
          trip={trip}
          currency={budgetCurrency}
          askDates={isOpen}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
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
              {isOpen && (
                <div className="budget-row">
                  <dt>Free</dt>
                  <dd>{trip.free_from ? formatDates(trip.free_from, trip.free_to) : 'Not set'}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p>You haven't entered a budget yet.</p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="row">
            {canEdit && (
              <button className="secondary" onClick={() => setEditing(true)}>
                {trip.budget ? 'Edit' : 'Add budget and dates'}
              </button>
            )}
            {isOpen && (
              <button className="secondary danger" onClick={leave}>Drop out</button>
            )}
          </div>
        </>
      )}
    </article>
  );
}

// What the whole group sees: progress, then the "fits everyone" shortlist.
// Never shows a budget, the ceiling, or who is limiting.
function GroupProgress({ trip }) {
  const total = trip.members.length;
  return (
    <div className="group-box">
      {total === 2 && (
        <p className="warning small">
          In a group of two, your friend can roughly work out your budget from the options shown.
        </p>
      )}
      {trip.status === 'planning' && (
        <p>
          <strong>{trip.ready_count} of {total}</strong> have added their budget and dates.
          Options appear once everyone has.
        </p>
      )}
      {trip.status === 'resolving' && (
        <p>
          <strong>No trip fits everyone yet.</strong> Try fewer nights, a closer region or different dates.
        </p>
      )}
      {trip.status === 'voting' && (
        <>
          <p><strong>Fits everyone</strong> <span className="muted small">· prices are estimates from sample data</span></p>
          <ul className="options">
            {trip.options.map((o) => (
              <li key={o.id}>
                <div>
                  <strong>{o.city}</strong>
                  <div className="muted small">
                    {formatDates(o.window_start, o.window_end)} · {nightsBetween(o.window_start, o.window_end)} nights
                  </div>
                </div>
                <div className="price">
                  ~{formatMoney(o.est_cost_pp_minor, o.currency)}
                  <div className="muted small">per person, shared</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BudgetForm({ trip, currency, askDates, onCancel, onSaved }) {
  // The inputs hold major units (e.g. "250.00"); the API takes minor units.
  const [values, setValues] = useState(() => ({
    ...Object.fromEntries(BUDGET_FIELDS.map((f) => [f.key, trip.budget ? String(Number(trip.budget[f.key]) / 100) : ''])),
    free_from: trip.free_from || '',
    free_to: trip.free_to || '',
  }));
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
    if (askDates) {
      if (!values.free_from || !values.free_to || values.free_to < values.free_from) {
        return setError('Enter the first and last day you could travel.');
      }
      body.free_from = values.free_from;
      body.free_to = values.free_to;
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

  const set = (key) => (e) => setValues({ ...values, [key]: e.target.value });

  return (
    <form className="budget-form" onSubmit={submit}>
      {BUDGET_FIELDS.map((f) => (
        <label key={f.key}>
          <span>{f.label} ({currency})</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={values[f.key]} onChange={set(f.key)} />
          <small className="muted">{f.hint}</small>
        </label>
      ))}
      {askDates && (
        <div className="row">
          <label>
            <span>Free from</span>
            <input type="date" value={values.free_from} onChange={set('free_from')} />
          </label>
          <label>
            <span>Free until</span>
            <input type="date" value={values.free_to} min={values.free_from || undefined} onChange={set('free_to')} />
          </label>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
