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

// One structured call to Gemini. "High demand" (503) or a used-up quota (429)
// falls back to the lighter model, which has its own separate quota.
async function generate(parts, schema) {
  const ai = await getClient();
  const request = {
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', responseJsonSchema: schema },
  };
  let response;
  try {
    response = await ai.models.generateContent(request);
  } catch (err) {
    if (![429, 503].includes(err.status) && !/UNAVAILABLE|RESOURCE_EXHAUSTED/.test(err.message)) throw err;
    console.warn(`gemini: ${MODEL} is busy or out of quota, trying ${FALLBACK_MODEL}`);
    response = await ai.models.generateContent({ ...request, model: FALLBACK_MODEL });
  }
  return JSON.parse(response.text);
}

// Returns a draft expense, or null if Gemini fails or the result doesn't look valid,
// so the caller can fall back to manual entry.
async function parseReceipt(imageBase64, mimeType) {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const r = await generate([
      { text: RECEIPT_PROMPT },
      { inlineData: { mimeType, data: imageBase64 } },
    ], RECEIPT_SCHEMA);
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

// Spoken expense -> the same draft as a receipt, plus who each item was for.
// Gemini picks people from the trip's names; ids are matched in code.
function transcriptSchema(names) {
  const people = { type: 'array', items: { type: 'string', enum: names } };
  return {
    type: 'object',
    properties: {
      understood: { type: 'boolean', description: 'false if this does not describe money that was spent' },
      total: { type: 'number', description: 'Total paid, or 0 if only item prices were said' },
      currency: { type: 'string', description: 'ISO 4217 code' },
      category: { type: 'string', enum: CATEGORIES },
      description: { type: 'string', description: 'Short label, e.g. "Dinner at Lupo" or "Taxi to airport"' },
      people: { ...people, description: 'Who the whole expense was for, when no items are given' },
      items: {
        type: 'array',
        description: 'Only items that were actually mentioned with a price',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: { type: 'number' },
            people: { ...people, description: 'Who had this item' },
          },
          required: ['name', 'price', 'people'],
        },
      },
    },
    required: ['understood', 'total', 'currency', 'category', 'description', 'people', 'items'],
  };
}

/**
 * @param {string} transcript  what the user said
 * @param {object} ctx
 * @param {Array<{user_id: string, name: string}>} ctx.members  everyone on the trip
 * @param {string} ctx.me               the speaker's user id
 * @param {string} ctx.defaultCurrency  used when no currency is said
 * @returns draft like parseReceipt's, items carry participant_ids, plus participant_ids
 *          for the whole expense; or null so the caller falls back to manual entry
 */
async function parseTranscript(transcript, { members, me, defaultCurrency }) {
  if (!process.env.GEMINI_API_KEY || !transcript.trim()) return null;
  const speaker = members.find((m) => m.user_id === me);
  const names = members.map((m) => m.name);
  const prompt =
    `${speaker.name} paid for something on a group trip and said:\n"${transcript}"\n\n` +
    `People on the trip: ${names.join(', ')}. "I", "me" and "myself" mean ${speaker.name}. ` +
    '"Everyone", "all of us" or "the group" means all of them. If nobody is named, it was for everyone. ' +
    `If no currency is said, use ${defaultCurrency}. Words like "quid" or "euros" give the currency. ` +
    'Return the total and, if prices were given for separate things, each item with who had it. ' +
    'When people each had their own ("we had the pasta for twelve each"), make one item per person, ' +
    'with just that person. Only put several people on an item they shared.';
  try {
    const r = await generate([{ text: prompt }], transcriptSchema(names));
    if (!r.understood) return null;
    const currency = String(r.currency || defaultCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return null;

    const idsFor = (list) => {
      const ids = members.filter((m) => (list || []).includes(m.name)).map((m) => m.user_id);
      return ids.length ? ids : members.map((m) => m.user_id);
    };
    const items = (Array.isArray(r.items) ? r.items : [])
      .filter((i) => i && i.price > 0)
      .map((i) => ({
        name: String(i.name || 'Item').trim(),
        amount_minor: toMinor(i.price, currency),
        participant_ids: idsFor(i.people),
      }));
    const total = r.total > 0 ? toMinor(r.total, currency) : items.reduce((s, i) => s + i.amount_minor, 0);
    if (!(total > 0)) return null;

    return {
      amount: { amount_minor: total, currency },
      category: CATEGORIES.includes(r.category) ? r.category : 'other',
      merchant: r.description || null,
      date: null,
      items,
      participant_ids: items.length ? [...new Set(items.flatMap((i) => i.participant_ids))] : idsFor(r.people),
    };
  } catch (err) {
    console.error('gemini parseTranscript failed:', err.message);
    return null;
  }
}

module.exports = { parseReceipt, parseTranscript };
