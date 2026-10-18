import { useCallback, useEffect, useState } from 'react';
import { api, formatMoney } from './api';
import Friends from './Friends';
import Trip from './Trip';
import NotificationBell, { timeAgo } from './Notifications';
import Avatar, { AvatarStack } from './Avatar';
import Insights from './Insights';
import { Approx, RatesProvider } from './money';
import { MonthBars, MONTH_NAMES, SplitBar, cheapestMonth, dearestMonth, percentLess, useInsights } from './charts';

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
  const [page, setPage] = useState('home'); // 'home' | 'insights'
  const [openTrip, setOpenTrip] = useState(null); // group id of the trip page being shown
  const [creating, setCreating] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false); // the friends panel, on phones
  const [friendCount, setFriendCount] = useState(null);

  const load = useCallback(() => {
    api('/account')
      .then(setAccount)
      .catch((err) => {
        if (err.message === 'unauthenticated') onLogOut();
        else setError(err.message);
      });
  }, [onLogOut]);

  useEffect(load, [load]);
  const onFriendsLoaded = useCallback((d) => setFriendCount(d.friends.length), []);

  if (error) {
    return (
      <section className="card">
        <p className="error">Couldn't load your account: {error}</p>
        <button className="secondary" onClick={onLogOut}>Log out</button>
      </section>
    );
  }
  if (!account) return <p>Loading…</p>;

  const { user, trips } = account;
  const goHome = () => {
    setPage('home');
    setOpenTrip(null);
    setFriendsOpen(false);
    load();
  };
  const showTrip = (groupId) => {
    setPage('home');
    setOpenTrip(groupId);
    setFriendsOpen(false);
    window.scrollTo(0, 0);
  };
  const showInsights = () => {
    setPage('insights');
    setFriendsOpen(false);
  };
  const findFriends = () => {
    setFriendsOpen(true);
    setTimeout(() => document.getElementById('friend-username')?.focus(), 0);
  };
  const onHome = page === 'home' && !openTrip;

  return (
    // Shared trip prices stay in the trip's currency; <Approx> adds "≈" in the viewer's own.
    <RatesProvider currency={user.home_currency} codes={trips.map((t) => t.base_currency)}>
      <header className="topbar">
        <button className="brand" onClick={goHome}>Group Trip Planner</button>
        <nav className="topnav" aria-label="Pages">
          <button aria-current={page === 'home' ? 'page' : undefined} onClick={goHome}>Home</button>
          <button aria-current={page === 'insights' ? 'page' : undefined} onClick={showInsights}>Insights</button>
        </nav>
        <div className="topbar-actions">
          <button className="secondary friends-toggle" aria-expanded={friendsOpen} onClick={() => setFriendsOpen(!friendsOpen)}>
            Friends
          </button>
          <NotificationBell onOpenTrip={showTrip} />
          <UserMenu user={user} onLogOut={onLogOut} />
        </div>
      </header>

      <div className={`layout${onHome ? ' layout-home' : ''}`}>
        <aside className={`sidebar${friendsOpen ? ' friends-open' : ''}`}>
          <ProfileCard user={user} trips={trips} friendCount={friendCount} />
          <section className="card side-card friends-card" aria-labelledby="friends-heading">
            <h3 id="friends-heading" className="card-title">Friends</h3>
            <Friends onLogOut={onLogOut} compact onLoaded={onFriendsLoaded} />
          </section>
        </aside>

        <main className="main">
          {page === 'insights' ? (
            <div className="insights-page">
              <h2 className="page-title">Insights</h2>
              <Insights />
            </div>
          ) : openTrip ? (
            <Trip groupId={openTrip} onLogOut={onLogOut} onBack={goHome} />
          ) : (
            <TripsHome
              user={user}
              trips={trips}
              creating={creating}
              setCreating={setCreating}
              onChanged={load}
              onOpenTrip={showTrip}
              onFindFriends={findFriends}
            />
          )}
        </main>
      </div>
    </RatesProvider>
  );
}

// Your avatar in the top bar, opening a small menu
function UserMenu({ user, onLogOut }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="user-menu">
      <button className="avatar-button" aria-expanded={open} aria-label={`${user.name}: account menu`} onClick={() => setOpen(!open)}>
        <Avatar username={user.username} name={user.name} size={34} />
      </button>
      {open && (
        <div className="menu-panel">
          <p className="menu-who">
            <strong>{user.name}</strong>
            <span className="muted small">@{user.username}</span>
          </p>
          <button className="secondary" onClick={onLogOut}>Log out</button>
        </div>
      )}
    </div>
  );
}

function ProfileCard({ user, trips, friendCount }) {
  const active = trips.filter((t) => !PAST.includes(t.status)).length;
  return (
    <section className="card side-card profile-card">
      <Avatar username={user.username} name={user.name} size={64} />
      <div>
        <h2 className="profile-name">{user.name}</h2>
        <p className="muted small">@{user.username}</p>
      </div>
      <div className="profile-chips">
        <span className="chip">{user.home_currency}</span>
        {user.departure_airport && <span className="chip">✈ {user.departure_airport}</span>}
      </div>
      <dl className="profile-stats">
        <div><dt>Trips</dt><dd>{active}</dd></div>
        <div><dt>Past</dt><dd>{trips.length - active}</dd></div>
        <div><dt>Friends</dt><dd>{friendCount ?? '–'}</dd></div>
      </dl>
    </section>
  );
}

function TripsHome({ user, trips, creating, setCreating, onChanged, onOpenTrip, onFindFriends }) {
  const card = (trip) => (
    <TripCard key={trip.group_id} trip={trip} user={user} onChanged={onChanged} onOpen={() => onOpenTrip(trip.group_id)} />
  );
  const current = trips.filter((t) => CURRENT.includes(t.status));
  const planned = trips.filter((t) => PLANNED.includes(t.status));
  const past = trips.filter((t) => PAST.includes(t.status));

  return (
    <>
      <div className="page-head">
        <h2 className="page-title">Your trips</h2>
        {!creating && <button onClick={() => setCreating(true)}>+ Plan a new trip</button>}
      </div>
      {creating && (
        <NewTrip
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onChanged();
          }}
          onFindFriends={onFindFriends}
        />
      )}

      {current.length > 0 && (
        <section>
          <h3 className="section-title">On the trip now</h3>
          {current.map(card)}
        </section>
      )}
      <section>
        <h3 className="section-title">Planning and booked</h3>
        {planned.length ? planned.map(card) : <p className="muted">No trips being planned. Start one with “Plan a new trip”.</p>}
      </section>
      {past.length > 0 && (
        <details className="past-trips">
          <summary className="section-title">Past trips ({past.length})</summary>
          {past.map(card)}
        </details>
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
            <Avatar username={f.username} name={f.name} size={24} />
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
      {!isOpen && trip.image_url && <img className="trip-photo" src={trip.image_url} alt={trip.city} loading="lazy" />}
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
      <p className="muted small with-people">
        {others.length > 0 && <AvatarStack people={others} size={24} />}
        With {others.length ? others.map((m) => m.name).join(', ') : 'nobody else yet'}
      </p>

      {isOpen && <GroupProgress trip={trip} onChanged={onChanged} />}
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
function GroupProgress({ trip, onChanged }) {
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
          <p>
            <strong>Fits everyone</strong> <span className="muted small">· vote yes or no. Votes are anonymous; everyone sees totals only.</span>
          </p>
          <ul className="options">
            {trip.options.map((o) => (
              <OptionCard key={o.id} option={o} trip={trip} total={total} onChanged={onChanged} />
            ))}
          </ul>
          <p className="muted small">Prices are estimates from sample data.</p>
        </>
      )}
    </div>
  );
}

// "~£96" or "~₦1,288,547": a rough price, so whole units and the short symbol
const roundMoney = (minor, currency) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 })
    .format(Number(minor) / 100);

// Your own return flight for this option. Only you see it; other people's flights stay private.
function YourFlight({ flight: f }) {
  const live = f.source === 'live';
  const details = [
    f.stops === 0 ? 'direct' : f.stops ? `${f.stops} stop${f.stops > 1 ? 's' : ''}` : null,
    f.airline,
  ].filter(Boolean);
  return (
    <p className="your-flight small">
      <span aria-hidden="true">✈ </span>
      Your flight from {f.from}: <strong>~{roundMoney(f.price_minor, f.currency)}</strong> return
      {details.length > 0 && ` · ${details.join(' · ')}`}
      <span className="muted">
        {' · '}
        {live ? `live price, ${timeAgo(f.fetched_at)}` : 'sample estimate'}
      </span>
      {f.google_flights_url && (
        <>
          {' · '}
          <a href={f.google_flights_url} target="_blank" rel="noopener noreferrer">Google Flights</a>
        </>
      )}
    </p>
  );
}

// One shortlisted place: photo, dates, price, your vote and the anonymous totals.
// Month-by-month spend for this option's city, with the trip's own month highlighted.
function OptionInsights({ option: o }) {
  const { data, error } = useInsights(o.currency);
  if (error) return <p className="error small">Couldn't load months: {error}</p>;
  if (!data) return <p className="muted small">Loading…</p>;
  const city = data.cities.find((c) => c.city === o.city);
  if (!city) return <p className="muted small">No past-group data for {o.city} yet.</p>;

  const tripMonth = Number(o.window_start.slice(5, 7)) - 1;
  const cheapest = cheapestMonth(city.months);
  const dearest = dearestMonth(city.months);
  const enough = city.months.filter(Boolean).length >= 3;
  const inTrip = city.months[tripMonth];
  const inCheapest = city.months[cheapest];
  const inDearest = city.months[dearest];

  return (
    <div className="option-insights">
      {!enough ? (
        <p className="muted small">Not enough data yet to compare months for {o.city}.</p>
      ) : cheapest === tripMonth ? (
        <p className="small"><strong>{MONTH_NAMES[tripMonth]} is the cheapest month</strong> to go to {o.city}.</p>
      ) : (
        <p className="small">
          In <strong>{MONTH_NAMES[cheapest]}</strong>, past groups spent about{' '}
          {inTrip ? `${percentLess(inCheapest, inTrip)}% less a day than in ${MONTH_NAMES[tripMonth]}` : 'the least'}.
        </p>
      )}
      {enough && dearest !== cheapest && (
        <p className="small">
          That's <strong>{percentLess(inCheapest, inDearest)}% cheaper</strong> than {MONTH_NAMES[dearest]}, the most expensive month
          {dearest === tripMonth ? ' (your trip month)' : ''}.
        </p>
      )}
      {enough && (
        <MonthBars
          months={city.months}
          currency={data.currency}
          highlight={tripMonth}
          label={`Spend per person per day in ${o.city}, by month, with your trip's month highlighted`}
        />
      )}
      {city.split && <SplitBar split={city.split} currency={data.currency} />}
      <p className="muted small">Sample data with a made-up seasonal pattern: illustrative only.</p>
    </div>
  );
}

function OptionCard({ option: o, trip, total, onChanged }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comparing, setComparing] = useState(false);
  const waiting = total - o.yes_votes - o.no_votes;
  const majority = o.yes_votes * 2 > total;
  const isOrganiser = trip.role === 'organiser';

  const run = async (request) => {
    setBusy(true);
    setError('');
    try {
      await request();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Clicking your current choice again takes the vote back.
  const vote = (approve) =>
    run(() =>
      api(`/trips/${trip.group_id}/options/${o.id}/vote`, {
        method: 'PUT',
        body: { approve: o.my_vote === approve ? null : approve },
      })
    );

  const book = () => {
    if (!window.confirm(`Book ${o.city}, ${formatDates(o.window_start, o.window_end)}? Voting closes for everyone.`)) return;
    run(() => api(`/trips/${trip.group_id}/options/${o.id}/book`, { method: 'POST' }));
  };

  return (
    <li className="option-card">
      {o.image_url && (
        <figure className="option-photo">
          <img src={o.image_url} alt={o.city} loading="lazy" />
          {o.image_credit_url && (
            <figcaption>
              <a href={o.image_credit_url} target="_blank" rel="noopener noreferrer">Photo: Wikimedia Commons</a>
            </figcaption>
          )}
        </figure>
      )}
      <div className="option-body">
        <div className="option-head">
          <div>
            <strong>{o.city}</strong>
            <div className="muted small">
              {formatDates(o.window_start, o.window_end)} · {nightsBetween(o.window_start, o.window_end)} nights
            </div>
          </div>
          <div className="price">
            ~{formatMoney(o.est_cost_pp_minor, o.currency)}
            <Approx minor={o.est_cost_pp_minor} from={o.currency} />
            <div className="muted small">per person, shared</div>
          </div>
        </div>
        {o.reason && (
          <p className="reason">
            {o.reason.text}
            {o.reason.source === 'cortex' && <span className="muted small ai-label"> · ✨ Written by Snowflake Cortex AI</span>}
          </p>
        )}
        {o.tags?.length > 0 && (
          <div className="chips">
            {o.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          </div>
        )}
        {o.your_flight && <YourFlight flight={o.your_flight} />}
        {o.past_spend && (
          <p className="muted small past-spend">
            {o.past_spend.month ? `In ${MONTH_NAMES[o.past_spend.month - 1]}, past groups spent about ` : 'Past groups spent about '}
            <strong>{formatMoney(o.past_spend.per_person_day_minor, o.past_spend.currency)}</strong>
            <Approx minor={o.past_spend.per_person_day_minor} from={o.past_spend.currency} /> per person a day
            here{o.past_spend.sample_only && ' · sample data'}
          </p>
        )}
        <div className="vote-row">
          <div className="vote-buttons" role="group" aria-label={`Your vote on ${o.city}`}>
            <button className={`vote yes ${o.my_vote === true ? 'chosen' : ''}`} aria-pressed={o.my_vote === true} disabled={busy} onClick={() => vote(true)}>
              👍 Yes
            </button>
            <button className={`vote no ${o.my_vote === false ? 'chosen' : ''}`} aria-pressed={o.my_vote === false} disabled={busy} onClick={() => vote(false)}>
              👎 No
            </button>
          </div>
          <span className="muted small">
            {o.yes_votes} yes · {o.no_votes} no{waiting > 0 && ` · ${waiting} still to vote`}
          </span>
        </div>
        {majority && (
          <div className="book-row">
            <span className="success small">Most of the group said yes</span>
            {isOrganiser && <button disabled={busy} onClick={book}>Book {o.city}</button>}
          </div>
        )}
        <button className="link compare" aria-expanded={comparing} onClick={() => setComparing(!comparing)}>
          {comparing ? 'Hide months' : 'Compare months'}
        </button>
        {comparing && <OptionInsights option={o} />}
        {error && <p className="error small">{error}</p>}
      </div>
    </li>
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
