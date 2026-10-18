// Currencies offered in pickers. All use 2 decimal places, which the app assumes
// when it converts between "12.50" and minor units (1250).
export const CURRENCIES = [
  'GBP', 'EUR', 'USD', 'NGN', 'CHF', 'CZK', 'HUF', 'PLN', 'DKK',
  'SEK', 'NOK', 'TRY', 'MAD', 'ZAR', 'CAD', 'AUD', 'INR', 'GHS', 'KES',
];

const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(undefined, { type: 'currency' }) : null;

function symbolFor(code) {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || code;
  } catch {
    return code;
  }
}

// e.g. "€ EUR · Euro", or "CHF · Swiss Franc" when the symbol is just the code
export function currencyLabel(code) {
  const symbol = symbolFor(code);
  const name = names?.of(code);
  return [symbol !== code ? `${symbol} ${code}` : code, name && name !== code ? name : null].filter(Boolean).join(' · ');
}

// The ones that matter for this trip first, then everything else.
export function currencyOptions(preferred = []) {
  const first = [...new Set(preferred.filter(Boolean))];
  return [...first, ...CURRENCIES.filter((c) => !first.includes(c))];
}
