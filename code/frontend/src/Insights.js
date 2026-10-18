// The Insights tab: the web version of the Snowflake dashboard.
import { useState } from 'react';
import { formatMoney } from './api';
import { CityBars, MonthBars, MONTHS, MONTH_NAMES, SplitBar, cheapestMonth, dearestMonth, percentLess, useInsights } from './charts';

export default function Insights() {
  const { data, error } = useInsights();
  const [picked, setPicked] = useState(null);

  if (error) return <p className="error">Couldn't load insights: {error}</p>;
  if (!data) return <p>Loading…</p>;

  const { cities, currency } = data;
  const withMonths = cities.filter((c) => c.months.filter(Boolean).length >= 3);
  const city = cities.find((c) => c.city === picked) || withMonths[0] || cities[0];
  if (!city) return <p className="muted">No insights yet.</p>;
  const cheapest = cheapestMonth(city.months);
  const dearest = dearestMonth(city.months);
  const monthsWithData = city.months.filter(Boolean).length;

  return (
    <>
      <p className="muted small insights-note">
        Anonymised spending from past trips plus a year of <strong>sample data</strong> with a made-up seasonal
        pattern, so treat month-to-month differences as illustrative.{' '}
        {data.source === 'snowflake' ? 'Via Snowflake.' : 'Worked out from the app database (Snowflake unavailable).'}
      </p>

      <section className="card">
        <h3 className="card-title">Spend per person per day</h3>
        <p className="muted small">Yearly average. Tap a destination to see its months.</p>
        <CityBars cities={cities} currency={currency} selected={city.city} onSelect={setPicked} />
      </section>

      <section className="card">
        <div className="insights-head">
          <h3 className="card-title">{city.city}</h3>
          <select value={city.city} onChange={(e) => setPicked(e.target.value)} aria-label="Destination">
            {cities.map((c) => <option key={c.city} value={c.city}>{c.city}</option>)}
          </select>
        </div>

        <h4>Cheapest month to go</h4>
        {monthsWithData >= 3 ? (
          <>
            <p className="small">
              <strong>{MONTH_NAMES[cheapest]}</strong> is the cheapest month here, at about{' '}
              {formatMoney(city.months[cheapest].per_person_day_minor, currency)} per person a day
              {city.yearly && <> ({percentLess(city.months[cheapest], city.yearly)}% below the yearly average)</>}.
              {dearest !== cheapest && (
                <> That's <strong>{percentLess(city.months[cheapest], city.months[dearest])}% cheaper</strong> than{' '}
                  {MONTH_NAMES[dearest]}, the most expensive month.</>
              )}
            </p>
            <MonthBars months={city.months} currency={currency} label={`Spend per person per day in ${city.city}, by month`} />
          </>
        ) : (
          <p className="muted small">Not enough data yet: a destination needs at least 3 months of spending to compare.</p>
        )}

        {city.split && (
          <>
            <h4>A typical day</h4>
            <p className="muted small">One night's stay, a day's food and a day's activities, per person. Sample data.</p>
            <SplitBar split={city.split} currency={currency} />
          </>
        )}
      </section>

      {withMonths.length > 0 && (
        <section className="card">
          <h3 className="card-title">Cheapest month for every destination</h3>
          <p className="muted small">Tap a destination to see its months above.</p>
          <div className="table-scroll">
            <table className="insights-table">
              <thead>
                <tr>
                  <th scope="col">Destination</th>
                  <th scope="col">Cheapest month</th>
                  <th scope="col" className="num">Per person a day</th>
                  <th scope="col" className="num">Saving</th>
                </tr>
              </thead>
              <tbody>
                {[...withMonths]
                  .sort((a, b) => a.months[cheapestMonth(a.months)].per_person_day_minor - b.months[cheapestMonth(b.months)].per_person_day_minor)
                  .map((c) => {
                    const i = cheapestMonth(c.months);
                    const top = dearestMonth(c.months);
                    return (
                      <tr key={c.city} className={c.city === city.city ? 'selected' : ''}>
                        <th scope="row">
                          <button className="row-link" onClick={() => setPicked(c.city)} aria-pressed={c.city === city.city}>
                            {c.city}
                          </button>
                        </th>
                        <td><i className="swatch-ink" aria-hidden="true" />{MONTH_NAMES[i]}</td>
                        <td className="num">{formatMoney(c.months[i].per_person_day_minor, currency)}</td>
                        <td className="num">
                          <span className="saving" title={`Compared with ${MONTH_NAMES[top]}, the most expensive month`}>
                            {percentLess(c.months[i], c.months[top])}% less than {MONTHS[top]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
