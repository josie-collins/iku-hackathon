// "≈ £325" in the viewer's own currency, next to amounts shown in a trip's currency.
// Shared trip numbers stay in the trip's currency so everyone sees the same figure;
// this only adds a hint for people who think in another currency.
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const RatesContext = createContext(null);
const requests = new Map(); // "EUR,GBP" -> promise of { rates, source }

/** Loads rates for `codes` and the viewer's `currency`, and makes <Approx> work inside it. */
export function RatesProvider({ currency, codes = [], children }) {
  const key = [...new Set([currency, ...codes].filter(Boolean))].sort().join(',');
  const [rates, setRates] = useState(null);

  useEffect(() => {
    if (!key) return undefined;
    if (!requests.has(key)) {
      requests.set(key, api(`/rates?currencies=${key}`).catch((err) => {
        requests.delete(key); // try again next time
        throw err;
      }));
    }
    let live = true;
    requests.get(key).then((data) => live && setRates(data.rates)).catch(() => live && setRates(null));
    return () => { live = false; };
  }, [key]);

  return <RatesContext.Provider value={{ currency, rates }}>{children}</RatesContext.Provider>;
}

/**
 * Returns approx(minor, from): the amount in the viewer's currency, e.g. "≈ £325",
 * or null when it's already their currency or rates aren't loaded.
 */
export function useApprox() {
  const ctx = useContext(RatesContext);
  return (minor, from) => {
    if (!ctx || !ctx.rates || !from || from === ctx.currency) return null;
    const { rates, currency } = ctx;
    if (!rates[from] || !rates[currency]) return null;
    // Rates are per 1 EUR; amounts are minor units (2 decimals throughout the app).
    // A rough figure, so whole units: "≈ £325", "≈ ₦586,655"
    const value = (Number(minor) / rates[from]) * rates[currency] / 100;
    return `≈ ${new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(value)}`;
  };
}

/** Renders " (≈ £325)" after an amount, or nothing. */
export function Approx({ minor, from }) {
  const text = useApprox()(minor, from);
  return text ? <span className="approx"> ({text})</span> : null;
}
