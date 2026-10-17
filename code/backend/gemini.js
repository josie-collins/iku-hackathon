// Gemini integration. Only ever receives receipts, transcripts and tags,
// never budgets, so this file must not import db.
const MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite'; // used when MODEL is overloaded (503); also free tier
const CATEGORIES = ['food', 'extras', 'accommodation', 'transport', 'other']; // same as expenses.js

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    total: { type: 'number', description: 'Final total paid, as printed on the receipt' },
    currency: { type: 'string', description: 'ISO 4217 code, e.g. EUR, GBP, NGN' },
    category: { type: 'string', enum: CATEGORIES },
    merchant: { type: 'string' },
    date: { type: 'string', description: 'YYYY-MM-DD, or empty if not printed' },
    items: {
      type: 'array',
      description: 'Each product line, in the order printed. Leave out subtotal, tax, tip and payment lines.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Product name, tidied into plain words' },
          price: { type: 'number', description: 'Line total for this product (quantity x unit price), after any discount on that line' },
        },
        required: ['name', 'price'],
      },
    },
  },
  required: ['total', 'currency', 'category', 'merchant', 'date', 'items'],
};

const RECEIPT_PROMPT =
  'Read this receipt. Return the final total paid (after tax and tip), its currency ' +
  'as an ISO 4217 code (infer it from symbols or the country if needed), the best ' +
  'category, the merchant name, the date, and every product line with its price.';

let client;
async function getClient() {
  if (!client) {
    const { GoogleGenAI } = await import('@google/genai'); // the SDK is an ES module
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// 42.5 EUR -> 4250, 1200 JPY -> 1200. Done in code, not by the model.
function toMinor(amount, currency) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency })
    .resolvedOptions().maximumFractionDigits;
  return Math.round(amount * 10 ** digits);
}

// Returns a draft expense, or null if Gemini fails or the result doesn't look valid,
// so the caller can fall back to manual entry.
async function parseReceipt(imageBase64, mimeType) {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const ai = await getClient();
    const request = {
      model: MODEL,
      contents: [{
        role: 'user',
        parts: [
          { text: RECEIPT_PROMPT },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      }],
      config: { responseMimeType: 'application/json', responseJsonSchema: RECEIPT_SCHEMA },
    };
    let response;
    try {
      response = await ai.models.generateContent(request);
    } catch (err) {
      // "High demand" (503): try the lighter model rather than make the user wait.
      if (err.status !== 503 && !/UNAVAILABLE/.test(err.message)) throw err;
      console.warn(`gemini: ${MODEL} is busy, trying ${FALLBACK_MODEL}`);
      response = await ai.models.generateContent({ ...request, model: FALLBACK_MODEL });
    }
    const r = JSON.parse(response.text);
    const currency = String(r.currency || '').toUpperCase();
    if (!(r.total > 0) || !/^[A-Z]{3}$/.test(currency)) return null;

    return {
      amount: { amount_minor: toMinor(r.total, currency), currency },
      category: CATEGORIES.includes(r.category) ? r.category : 'other',
      merchant: r.merchant || null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
      // Items are a starting point for the split; the user can edit them, and the
      // server splits the total in proportion to them, so they needn't add up exactly.
      items: (Array.isArray(r.items) ? r.items : [])
        .filter((i) => i && i.price > 0)
        .map((i) => ({ name: String(i.name || 'Item').trim(), amount_minor: toMinor(i.price, currency) })),
    };
  } catch (err) {
    console.error('gemini parseReceipt failed:', err.message);
    return null;
  }
}

module.exports = { parseReceipt };
