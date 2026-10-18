import { useCallback, useEffect, useState } from 'react';
import { api, formatMoney } from './api';
import { currencyLabel, currencyOptions } from './currencies';
import { describeActivity, timeAgo } from './Notifications';
import Avatar, { AvatarStack } from './Avatar';
import { Approx, RatesProvider } from './money';

const LOGGABLE = ['booked', 'on_trip'];

const TYPES = [
  { key: 'shared', label: 'Shared', hint: 'Split between the people you pick' },
  { key: 'extra', label: 'Extra', hint: 'Only for the people who joined in' },
  { key: 'personal', label: 'Personal', hint: 'Just you. Nobody else sees it.' },
];

const CATEGORIES = [
  ['food', 'Food'],
  ['extras', 'Extras'],
  ['accommodation', 'Stay'],
  ['transport', 'Transport'],
  ['other', 'Other'],
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES);

const formatDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function Trip({ groupId, onBack, onLogOut }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api(`/trips/${groupId}`)
      .then(setData)
      .catch((err) => {
        if (err.message === 'unauthenticated') onLogOut();
        else setError(err.message);
      });
  }, [groupId, onLogOut]);

  useEffect(load, [load]);

  if (error) {
    return (
      <>
        <button className="link back" onClick={onBack}>← Your trips</button>
        <p className="error">{error}</p>
      </>
    );
  }
  if (!data) return <p>Loading…</p>;

  const { trip, me, members } = data;
  const nameOf = (id) => (id === me ? 'You' : members.find((m) => m.user_id === id)?.name || 'Someone');
  const avatarOf = (id, size) => {
    const m = members.find((x) => x.user_id === id);
    return <Avatar username={m?.username} name={m?.name} size={size} />;
  };
  const myCurrency = members.find((m) => m.user_id === me)?.home_currency || trip.base_currency;
  const canLog = LOGGABLE.includes(trip.status);
  const isOrganiser = trip.role === 'organiser';

  const organiserAction = (path) => async () => {
    try {
      await api(`/trips/${groupId}/${path}`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    // Trip amounts stay in the trip's currency; <Approx> adds "≈" in yours when they differ.
    <RatesProvider currency={myCurrency} codes={[trip.base_currency, ...members.map((m) => m.home_currency)]}>
      <button className="link back" onClick={onBack}>← Your trips</button>

      <section className="card trip-header">
        {trip.image_url && (
          <figure className="trip-hero">
            <img src={trip.image_url} alt={trip.city} />
            {trip.image_credit_url && (
              <figcaption>
                <a href={trip.image_credit_url} target="_blank" rel="noopener noreferrer">Photo: Wikimedia Commons</a>
              </figcaption>
            )}
          </figure>
        )}
        <header>
          <h2>{trip.name}</h2>
          {trip.status === 'on_trip' && <span className="status status-on_trip">Day {Math.max(trip.current_day, 1)}</span>}
          {trip.status === 'settled' && <span className="status">Settled</span>}
          {trip.status === 'booked' && <span className="status status-booked">Booked</span>}
        </header>
        <p className="muted with-people">
          <AvatarStack people={members} size={28} />
          {[trip.city, members.map((m) => (m.user_id === me ? 'you' : m.name)).join(', ')].filter(Boolean).join(' · ')}
        </p>
        {isOrganiser && trip.status === 'booked' && (
          <button onClick={organiserAction('start')}>Start the trip</button>
        )}
        {isOrganiser && trip.status === 'on_trip' && (
          <button className="secondary" onClick={organiserAction('next-day')}>Simulate next day</button>
        )}
      </section>

      {data.pace && <Pace pace={data.pace} />}

      {canLog &&
        (adding ? (
          <ExpenseForm
            groupId={groupId}
            me={me}
            members={members}
            defaultCurrency={myCurrency}
            tripCurrencies={[myCurrency, trip.base_currency, ...members.map((m) => m.home_currency)]}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              load();
            }}
          />
        ) : (
          <button className="new-trip" onClick={() => setAdding(true)}>+ Add an expense</button>
        ))}

      <Ledger data={data} nameOf={nameOf} avatarOf={avatarOf} canDelete={canLog} groupId={groupId} onChanged={load} />
      <Activity activity={data.activity} nameOf={nameOf} avatarOf={avatarOf} />
      <SettleUp data={data} nameOf={nameOf} avatarOf={avatarOf} isOrganiser={isOrganiser} canSettle={canLog} groupId={groupId} onChanged={load} />
    </RatesProvider>
  );
}

// Only ever shown to the member it belongs to (the API only returns your own).
function Pace({ pace }) {
  const under = pace.underMinor >= 0;
  return (
    <section className={`card pace ${under ? 'pace-under' : 'pace-over'}`}>
      <p className="muted small">Your pace · only you can see this</p>
      <p className="pace-line">
        You're <strong>{formatMoney(Math.abs(pace.underMinor), pace.currency)}</strong> {under ? 'under' : 'over'} your daily pace.
      </p>
      <p className="muted small">
        {formatMoney(pace.spentMinor, pace.currency)} spent on food, extras and personal things over{' '}
        {pace.days === 1 ? '1 day' : `${pace.days} days`}, out of {formatMoney(pace.allowanceMinor, pace.currency)}.
      </p>
    </section>
  );
}

function ExpenseForm({ groupId, me, members, defaultCurrency, tripCurrencies, onCancel, onSaved }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('food');
  const [type, setType] = useState('shared');
  const [picked, setPicked] = useState(() => new Set(members.map((m) => m.user_id)));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const chooseType = (next) => {
    setType(next);
    // Sensible starting point: shared = everyone, extra = just you, then tick who joined.
    if (next === 'shared') setPicked(new Set(members.map((m) => m.user_id)));
    if (next === 'extra') setPicked(new Set([me]));
  };

  const toggle = (id) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value <= 0) return setError('Enter an amount above 0.');
    if (type !== 'personal' && !picked.size) return setError('Pick who this was for.');
    setSaving(true);
    setError('');
    try {
      await api(`/trips/${groupId}/expenses`, {
        method: 'POST',
        body: {
          amount_minor: Math.round(value * 100),
          currency,
          description,
          category,
          type,
          participant_ids: type === 'personal' ? [me] : [...picked],
        },
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h3 className="card-title">What did you pay for?</h3>
      <div className="row">
        <label>
          <span>Amount</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </label>
        <label>
          <span>Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencyOptions(tripCurrencies).map((code) => (
              <option key={code} value={code}>{currencyLabel(code)}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <span>What was it?</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Dinner, taxi, museum…" />
      </label>
      <label>
        <span>Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </label>

      <fieldset className="type-picker">
        <legend>Who is it for?</legend>
        <div className="segmented">
          {TYPES.map((t) => (
            <button type="button" key={t.key} className={type === t.key ? 'active' : ''} onClick={() => chooseType(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <small className="muted">{TYPES.find((t) => t.key === type).hint}</small>
        {type !== 'personal' &&
          members.map((m) => (
            <label key={m.user_id} className="check">
              <input type="checkbox" checked={picked.has(m.user_id)} onChange={() => toggle(m.user_id)} />
              <span>{m.user_id === me ? 'You' : m.name}</span>
            </label>
          ))}
      </fieldset>

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add expense'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Ledger({ data, nameOf, avatarOf, canDelete, groupId, onChanged }) {
  const { trip, me, expenses } = data;

  const remove = async (e) => {
    if (!window.confirm(`Delete "${e.description || CATEGORY_LABELS[e.category]}"?`)) return;
    try {
      await api(`/trips/${groupId}/expenses/${e.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      window.alert(err.message);
    }
  };

  return (
    <section>
      <h2>Expenses</h2>
      {!expenses.length && <p className="muted">Nothing logged yet.</p>}
      <ul className="ledger">
        {expenses.map((e) => {
          const myShare = e.participants.find((p) => p.user_id === me)?.share_base_minor;
          const converted = e.currency !== trip.base_currency;
          return (
            <li key={e.id}>
              <div className="ledger-main">
                <div className="ledger-who">
                  {avatarOf(e.payer_id, 32)}
                  <div>
                    <strong>{e.description || CATEGORY_LABELS[e.category]}</strong>
                    <div className="muted small">
                      {nameOf(e.payer_id)} paid · {formatDay(e.spent_on)} · {CATEGORY_LABELS[e.category]}
                      {e.type !== 'shared' && <span className={`tag tag-${e.type}`}>{e.type}</span>}
                    </div>
                  </div>
                </div>
                <div className="price">
                  {formatMoney(e.amount_minor, e.currency)}
                  <Approx minor={e.amount_minor} from={e.currency} />
                  {converted && (
                    <div className="muted small">
                      ≈ {formatMoney(e.amount_base_minor, trip.base_currency)}
                      {e.fx_source === 'fallback' && ' · fallback rate'}
                    </div>
                  )}
                </div>
              </div>
              <div className="ledger-foot muted small">
                {e.type === 'personal'
                  ? 'Only you can see this'
                  : `Split between ${e.participants.map((p) => nameOf(p.user_id)).join(', ')}`}
                {myShare != null && e.type !== 'personal' && (
                  <span>
                    · your share {formatMoney(myShare, trip.base_currency)}
                    <Approx minor={myShare} from={trip.base_currency} />
                  </span>
                )}
                {canDelete && e.payer_id === me && (
                  <button className="link danger" onClick={() => remove(e)}>Delete</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Who added or deleted what. Personal entries only appear for the person who paid.
function Activity({ activity, nameOf, avatarOf }) {
  if (!activity.length) return null;
  return (
    <section>
      <h2>Activity</h2>
      <ul className="activity">
        {activity.map((a) => (
          <li key={a.id} className={a.action === 'expense_deleted' ? 'deleted' : ''}>
            <span className="person-who">{avatarOf(a.actor_id, 22)} {describeActivity(a, nameOf(a.actor_id))}</span>
            <span className="muted small">{timeAgo(a.created_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SettleUp({ data, nameOf, avatarOf, isOrganiser, canSettle, groupId, onChanged }) {
  const { trip, me, balances, suggested, settlements, rates } = data;
  const myCurrency = data.members.find((m) => m.user_id === me)?.home_currency || trip.base_currency;
  const [busy, setBusy] = useState(false);

  const settle = async () => {
    if (!window.confirm('Settle up now? This ends the trip: no more expenses can be added.')) return;
    setBusy(true);
    try {
      await api(`/trips/${groupId}/settle`, { method: 'POST' });
      onChanged();
    } catch (err) {
      window.alert(err.message);
      setBusy(false);
    }
  };

  const markPaid = async (id) => {
    try {
      await api(`/trips/${groupId}/settlements/${id}/paid`, { method: 'POST' });
      onChanged();
    } catch (err) {
      window.alert(err.message);
    }
  };

  const payments = settlements.length ? settlements : suggested;

  return (
    <section>
      <h2>Settle up</h2>
      <div className="card">
        <h4 className="card-title">Balances</h4>
        <ul className="balances">
          {balances.map((b) => (
            <li key={b.user_id}>
              <span className="person-who">{avatarOf(b.user_id, 24)} {nameOf(b.user_id)}</span>
              <span className={b.balance_base_minor > 0 ? 'owed' : b.balance_base_minor < 0 ? 'owes' : 'muted'}>
                {b.balance_base_minor > 0 && `is owed ${formatMoney(b.balance_base_minor, trip.base_currency)}`}
                {b.balance_base_minor < 0 && `owes ${formatMoney(-b.balance_base_minor, trip.base_currency)}`}
                {b.balance_base_minor !== 0 && <Approx minor={Math.abs(b.balance_base_minor)} from={trip.base_currency} />}
                {b.balance_base_minor === 0 && 'all square'}
              </span>
            </li>
          ))}
        </ul>

        <h4>{settlements.length ? 'Payments' : 'Payments if you settled now'}</h4>
        {!payments.length && <p className="muted">Nobody owes anybody anything.</p>}
        <ul className="payments">
          {payments.map((p, i) => (
            <li key={p.id || i}>
              <div>
                <strong>{nameOf(p.from_user)}</strong> {p.from_user === me ? 'pay' : 'pays'} <strong>{nameOf(p.to_user)}</strong>
                <div className="muted small">
                  {formatMoney(p.amount_minor, p.currency)}
                  {p.currency !== trip.base_currency && ` (${formatMoney(p.amount_base_minor, trip.base_currency)})`}
                  {/* Only when neither amount above is already in the viewer's currency */}
                  {p.currency !== myCurrency && trip.base_currency !== myCurrency && (
                    <Approx minor={p.amount_minor} from={p.currency} />
                  )}
                  {p.settled_at && ' · paid'}
                </div>
              </div>
              {p.id && p.from_user === me && !p.settled_at && (
                <div className="actions">
                  <a className="button" href={p.wise_link} target="_blank" rel="noopener noreferrer">Pay with Wise</a>
                  <button className="secondary" onClick={() => markPaid(p.id)}>Mark paid</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!settlements.length && rates.source === 'fallback' && payments.some((p) => p.currency !== trip.base_currency) && (
          <p className="muted small">Converted with fallback rates because Wise couldn't be reached.</p>
        )}
        {canSettle && isOrganiser && (
          <button onClick={settle} disabled={busy}>{busy ? 'Settling…' : 'Settle up and end the trip'}</button>
        )}
        {canSettle && !isOrganiser && <p className="muted small">The organiser settles up at the end of the trip.</p>}
      </div>
    </section>
  );
}
