import { useCallback, useEffect, useState } from 'react';
import { api, formatMoney } from './api';
import { currencyLabel, currencyOptions } from './currencies';
import { describeActivity, timeAgo } from './Notifications';
import Avatar, { AvatarStack } from './Avatar';

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
        <button className="link back" onClick={onBack}>← All trips</button>
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
    <>
      <button className="link back" onClick={onBack}>← All trips</button>

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
    </>
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

// Phone photos are big: shrink to a JPEG before sending. If the browser can't
// decode it (e.g. HEIC outside Safari), send the original file instead.
const MAX_SIDE = 1600;
async function photoToBase64(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return { base64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], mimeType: 'image/jpeg' };
  } catch {
    return { base64: dataUrl.split(',')[1], mimeType: file.type || 'image/jpeg' };
  }
}

const toMinor = (value) => Math.round(Number(value) * 100);

function ExpenseForm({ groupId, me, members, defaultCurrency, tripCurrencies, onCancel, onSaved }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('food');
  const [type, setType] = useState('shared');
  const [picked, setPicked] = useState(() => new Set(members.map((m) => m.user_id)));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Receipt lines, each with the people it was for: [{ name, price, picked: Set }]
  const [items, setItems] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const byItem = items.length > 0 && type !== 'personal';
  const nameOf = (id) => (id === me ? 'You' : members.find((m) => m.user_id === id)?.name || 'Someone');

  const scan = async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // so picking the same photo again still triggers a scan
    if (!file) return;
    setScanning(true);
    setScanNote('');
    setError('');
    try {
      const { base64, mimeType } = await photoToBase64(file);
      const { draft } = await api(`/trips/${groupId}/parse-receipt`, {
        method: 'POST',
        body: { image_base64: base64, mime_type: mimeType },
      });
      if (!draft) {
        setScanNote("Couldn't read that receipt. Fill it in below instead.");
        return;
      }
      setAmount(String(draft.amount.amount_minor / 100));
      setCurrency(draft.amount.currency);
      if (draft.merchant) setDescription(draft.merchant);
      setCategory(draft.category);
      if (type === 'personal') setType('shared');
      const everyone = members.map((m) => m.user_id);
      setItems(draft.items.map((i) => ({ name: i.name, price: String(i.amount_minor / 100), picked: new Set(everyone) })));
      setScanNote(draft.items.length
        ? 'Read by Gemini. Check the numbers, then tap who had each item.'
        : 'Read by Gemini. Check the numbers below.');
    } catch (err) {
      setScanNote(err.message);
    } finally {
      setScanning(false);
    }
  };

  const updateItem = (index, change) => setItems(items.map((item, i) => (i === index ? { ...item, ...change } : item)));
  const toggleItemPerson = (index, id) => {
    const next = new Set(items[index].picked);
    next.has(id) ? next.delete(id) : next.add(id);
    updateItem(index, { picked: next });
  };

  // Preview of what each person pays: the total split in proportion to their items,
  // the same way the server does it (tax, tip and rounding shared fairly).
  const itemShares = () => {
    const weights = Object.fromEntries(members.map((m) => [m.user_id, 0]));
    for (const item of items) {
      const price = Number(item.price) || 0;
      for (const id of item.picked) weights[id] += price / item.picked.size;
    }
    const sum = Object.values(weights).reduce((s, w) => s + w, 0);
    const total = Number(amount) || sum;
    return members
      .filter((m) => weights[m.user_id] > 0)
      .map((m) => ({ id: m.user_id, minor: sum ? Math.round((total * weights[m.user_id]) / sum * 100) : 0 }));
  };
  const itemsTotal = items.reduce((s, i) => s + (Number(i.price) || 0), 0);

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
    if (byItem) {
      if (items.some((i) => !Number.isFinite(Number(i.price)) || Number(i.price) < 0)) return setError('Every item needs a price.');
      if (items.some((i) => !i.picked.size)) return setError('Pick who had each item.');
      if (!items.some((i) => Number(i.price) > 0)) return setError('The items add up to nothing.');
    } else if (type !== 'personal' && !picked.size) return setError('Pick who this was for.');
    setSaving(true);
    setError('');
    try {
      await api(`/trips/${groupId}/expenses`, {
        method: 'POST',
        body: {
          amount_minor: toMinor(value),
          currency,
          description,
          category,
          type,
          ...(byItem
            ? { items: items.map((i) => ({ amount_minor: toMinor(i.price), participant_ids: [...i.picked] })) }
            : { participant_ids: type === 'personal' ? [me] : [...picked] }),
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
      <label className={`scan-button ${scanning ? 'busy' : ''}`}>
        <input type="file" accept="image/*" capture="environment" onChange={scan} disabled={scanning} hidden />
        <span>{scanning ? 'Reading the receipt…' : '📷 Scan a receipt'}</span>
      </label>
      {scanNote && <p className="muted small">{scanNote}</p>}
      <div className="row">
        <label>
          <span>Amount</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </label>
        <label>
          <span>Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencyOptions([currency, ...tripCurrencies]).map((code) => (
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
        {type !== 'personal' && !byItem &&
          members.map((m) => (
            <label key={m.user_id} className="check">
              <input type="checkbox" checked={picked.has(m.user_id)} onChange={() => toggle(m.user_id)} />
              <span>{m.user_id === me ? 'You' : m.name}</span>
            </label>
          ))}
      </fieldset>

      {byItem && (
        <fieldset className="items">
          <legend>Split by item</legend>
          <ul>
            {items.map((item, i) => (
              <li key={i}>
                <div className="item-line">
                  <input aria-label="Item" value={item.name} onChange={(e) => updateItem(i, { name: e.target.value })} />
                  <input aria-label="Price" className="item-price" type="number" inputMode="decimal" min="0" step="0.01"
                    value={item.price} onChange={(e) => updateItem(i, { price: e.target.value })} />
                  <button type="button" className="item-remove" aria-label={`Remove ${item.name}`}
                    onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>
                </div>
                <div className="chips">
                  {members.map((m) => (
                    <button type="button" key={m.user_id} aria-pressed={item.picked.has(m.user_id)}
                      className={`chip ${item.picked.has(m.user_id) ? 'on' : ''}`}
                      onClick={() => toggleItemPerson(i, m.user_id)}>
                      {nameOf(m.user_id)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="link"
            onClick={() => setItems([...items, { name: '', price: '', picked: new Set(members.map((m) => m.user_id)) }])}>
            + Add an item
          </button>
          {Math.abs(itemsTotal - (Number(amount) || 0)) >= 0.01 && (
            <p className="muted small">
              Items add up to {formatMoney(toMinor(itemsTotal), currency)}. The total of {formatMoney(toMinor(amount || 0), currency)} (with
              tax, tip or discounts) is split in the same proportions.
            </p>
          )}
          <ul className="item-shares">
            {itemShares().map((s) => (
              <li key={s.id}><span>{nameOf(s.id)}</span><strong>{formatMoney(s.minor, currency)}</strong></li>
            ))}
          </ul>
          <button type="button" className="link" onClick={() => setItems([])}>Split evenly instead</button>
        </fieldset>
      )}

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
                {myShare != null && e.type !== 'personal' && ` · your share ${formatMoney(myShare, trip.base_currency)}`}
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
