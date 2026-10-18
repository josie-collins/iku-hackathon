// Small hand-built SVG charts for destination insights. The stay/food/activities
// split uses the validated categorical slots (blue, orange, aqua). The month chart
// is deliberately colourless (ink, outline, grey) so it can't be confused with the
// split shown next to it: no five hues stay distinguishable on one screen. Every
// chart has hover values and a text alternative, so colour never carries meaning alone.
import { useEffect, useState } from 'react';
import { api, formatMoney } from './api';
import { Approx } from './money';

export const COLORS = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', grey: '#d3d2cc', ink: '#33322e', paper: '#ffffff' };
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// One request per currency, shared by every card and the Insights tab.
const requests = new Map();
export function useInsights(currency) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    const key = currency || 'home';
    if (!requests.has(key)) {
      requests.set(key, api(`/insights${currency ? `?currency=${currency}` : ''}`).catch((err) => {
        requests.delete(key); // allow a retry
        throw err;
      }));
    }
    let live = true;
    requests.get(key)
      .then((data) => live && setState({ data, error: '' }))
      .catch((err) => live && setState({ data: null, error: err.message }));
    return () => { live = false; };
  }, [currency]);
  return state;
}

/** Index of the cheapest month with data, or -1. */
export function cheapestMonth(months) {
  return pickMonth(months, (a, b) => a < b);
}

/** Index of the most expensive month with data, or -1. */
export function dearestMonth(months) {
  return pickMonth(months, (a, b) => a > b);
}

function pickMonth(months, better) {
  let best = -1;
  months.forEach((m, i) => {
    if (m && (best < 0 || better(m.per_person_day_minor, months[best].per_person_day_minor))) best = i;
  });
  return best;
}

/** How much less `low` is than `high`, as a whole percentage. */
export const percentLess = (low, high) => Math.round(100 * (1 - low.per_person_day_minor / high.per_person_day_minor));

/**
 * 12 monthly bars. `highlight` (e.g. the trip's month) is blue, the cheapest month
 * is orange, the rest grey context.
 */
export function MonthBars({ months, currency, highlight = -1, label }) {
  const [hover, setHover] = useState(-1);
  const cheapest = cheapestMonth(months);
  const max = Math.max(...months.map((m) => (m ? m.per_person_day_minor : 0)), 1);
  const W = 360, H = 120, top = 8, bottom = 18, slot = W / 12, barW = slot * 0.62;
  const shown = hover >= 0 ? hover : highlight >= 0 ? highlight : cheapest;
  // Cheapest = solid ink; your trip = ink outline; both = solid ink. Everything else grey.
  const fillOf = (i) => (i === cheapest ? COLORS.ink : i === highlight ? COLORS.paper : COLORS.grey);
  const strokeOf = (i) => (i === highlight ? COLORS.ink : 'none');

  return (
    <figure className="chart">
      <div className="chart-readout" aria-live="polite">
        {shown >= 0 && months[shown] ? (
          <>
            <strong>{MONTH_NAMES[shown]}</strong>: {formatMoney(months[shown].per_person_day_minor, currency)}
            <Approx minor={months[shown].per_person_day_minor} from={currency} /> per person a day
          </>
        ) : (
          <span className="muted">No data for that month</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(-1)}>
        <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} className="chart-baseline" />
        {months.map((m, i) => {
          const x = i * slot + (slot - barW) / 2;
          const h = m ? Math.max(2, ((H - top - bottom) * m.per_person_day_minor) / max) : 0;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              {/* Hit target: the whole column, bigger than the bar */}
              <rect x={i * slot} y="0" width={slot} height={H} fill="transparent" />
              {m && (
                <path
                  // Bar with 4px rounded top corners, square at the baseline
                  d={`M${x},${H - bottom} v${-(h - 4)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 v${h - 4} z`}
                  fill={fillOf(i)}
                  stroke={strokeOf(i)}
                  strokeWidth={i === highlight ? 2 : 0}
                  opacity={hover >= 0 && hover !== i ? 0.55 : 1}
                >
                  <title>{`${MONTH_NAMES[i]}: ${formatMoney(m.per_person_day_minor, currency)} a day`}</title>
                </path>
              )}
              <text x={i * slot + slot / 2} y={H - 4} textAnchor="middle" className="chart-tick">{MONTHS[i][0]}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="chart-legend">
        {cheapest >= 0 && <span><i style={{ background: COLORS.ink }} /> Cheapest month</span>}
        {highlight >= 0 && cheapest !== highlight && <span><i className="swatch-outline" /> Your trip</span>}
        {highlight >= 0 && cheapest === highlight && <span className="muted">Your trip is in the cheapest month</span>}
      </figcaption>
      <details className="chart-table">
        <summary>Show as a table</summary>
        <table>
          <tbody>
            {months.map((m, i) => (
              <tr key={i}>
                <th scope="row">{MONTH_NAMES[i]}</th>
                <td>{m ? formatMoney(m.per_person_day_minor, currency) : 'no data'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

const PARTS = [
  { key: 'stay_minor', label: 'Stay', color: COLORS.blue },
  { key: 'food_minor', label: 'Food', color: COLORS.orange },
  { key: 'activities_minor', label: 'Activities', color: COLORS.aqua },
];

/** One stacked bar: a typical day's stay, food and activities, with the values written out. */
export function SplitBar({ split, currency }) {
  const total = PARTS.reduce((sum, p) => sum + split[p.key], 0);
  if (!total) return null;
  const parts = PARTS.filter((p) => split[p.key] > 0);
  return (
    <figure className="chart">
      <div
        className="split-bar"
        role="img"
        aria-label={`A typical day: ${parts.map((p) => `${p.label} ${formatMoney(split[p.key], currency)}`).join(', ')}`}
      >
        {parts.map((p) => (
          <span
            key={p.key}
            style={{ flexGrow: split[p.key], background: p.color }}
            title={`${p.label}: ${formatMoney(split[p.key], currency)}`}
          />
        ))}
      </div>
      {/* Values as text: the aqua slot is low-contrast, so the legend carries the numbers */}
      <figcaption className="chart-legend">
        {parts.map((p) => (
          <span key={p.key}>
            <i style={{ background: p.color }} /> {p.label} {formatMoney(split[p.key], currency)}
          </span>
        ))}
        <span className="muted">= {formatMoney(total, currency)}<Approx minor={total} from={currency} /> a day</span>
      </figcaption>
    </figure>
  );
}

/** Horizontal bars, one per city, of the yearly average. Click a bar to pick that city. */
export function CityBars({ cities, currency, selected, onSelect }) {
  const rows = cities.filter((c) => c.yearly).sort((a, b) => b.yearly.per_person_day_minor - a.yearly.per_person_day_minor);
  const max = Math.max(...rows.map((c) => c.yearly.per_person_day_minor), 1);
  return (
    <ul className="city-bars">
      {rows.map((c) => (
        <li key={c.city}>
          <button
            className={c.city === selected ? 'selected' : ''}
            aria-pressed={c.city === selected}
            onClick={() => onSelect(c.city)}
            title={`${c.city}: ${formatMoney(c.yearly.per_person_day_minor, currency)} per person a day`}
          >
            <span className="city-name">{c.city}</span>
            <span className="city-track">
              <span className="city-fill" style={{ width: `${(100 * c.yearly.per_person_day_minor) / max}%` }} />
            </span>
            <span className="city-value">{formatMoney(c.yearly.per_person_day_minor, currency)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
