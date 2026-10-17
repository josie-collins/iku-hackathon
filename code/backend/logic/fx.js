// Currency conversion on integer minor units (pence, cents, kobo).
//
// `rates` maps a currency code to how many units of that currency equal ONE unit
// of the base currency. With base EUR: { EUR: 1, GBP: 0.86, NGN: 1700 }.
// Pure: no network, no database. Rates come from integrations/wise.js.

// Currencies whose minor unit isn't 1/100. Everything else defaults to 2 decimals.
const MINOR_DIGITS = { JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, HUF: 2, BHD: 3, KWD: 3, JOD: 3, OMR: 3 };

function minorDigits(currency) {
  return MINOR_DIGITS[currency] ?? 2;
}

function rateFor(rates, currency) {
  const rate = rates[currency];
  if (typeof rate !== 'number' || !(rate > 0)) {
    throw new Error(`No exchange rate for ${currency}`);
  }
  return rate;
}

/**
 * Convert an amount in minor units from one currency to another.
 * Rounds to the nearest minor unit of the target currency.
 */
function convertMinor(amountMinor, from, to, rates) {
  if (from === to) return amountMinor;
  const major = amountMinor / 10 ** minorDigits(from);
  const inBase = major / rateFor(rates, from);
  const target = inBase * rateFor(rates, to);
  return Math.round(target * 10 ** minorDigits(to));
}

/** The rate used to convert `from` into `to` (1 unit of from = N units of to). */
function rateBetween(from, to, rates) {
  if (from === to) return 1;
  return rateFor(rates, to) / rateFor(rates, from);
}

module.exports = { convertMinor, rateBetween, minorDigits };
