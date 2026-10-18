# Budget Group Trip Planner

**Tagline:** Transparent costs, private budgets.

**Track:** Wise – Max Ease. **Side challenges:** ElevenLabs, MLH Best Use of Gemini API, MLH Best Use of Snowflake API, MLH Best Use of Tiger Data.

## Inspiration

We've all seen group trips get complicated before they've even started. One person wants a weekend away, another is trying to save money, and someone else has to coordinate everyone's schedules. Eventually the conversation turns to budgets, and not everyone feels comfortable saying what they can afford.

It's even harder when friends live in different countries: flights cost each person something different, everyone thinks in a different currency, and the receipts end up scattered across a group chat. We wanted travelling with friends to be about the trip, not about explaining your finances.

## What it does

Each person privately enters three budgets in their home currency (flights, their share of group costs, and a daily budget for food and extras), plus the dates they're free. Nobody else ever sees these numbers.

The server combines everyone's private inputs into one shortlist labelled "fits everyone". A destination only appears if every member's flight (live prices from their own airport), share of the stay and daily food costs fit within their own budgets. The group's spending ceiling is computed on the server and never sent to anyone. Each option shows what past groups spent there per day. The group votes anonymously, so everyone sees totals, never who voted for what. If nothing fits, everyone sees the same neutral message, which never says whose budget is the limit.

On the trip, you can photograph a receipt and Gemini reads every line. You tap who had what, and the bill is split by what each person actually had. Or you just say it: "I paid 42 euros for dinner, Amara had the pasta for twelve." ElevenLabs transcribes it, Gemini turns it into a draft, you confirm, and ElevenLabs reads back "Saved €42 for Dinner. Amara owes you €12." Expenses can be shared or personal, in any currency, at live Wise rates. Each person privately sees how they're doing against their own daily pace.

At the end, the app works out who owes whom with the fewest payments, converts each one into the payer's home currency and links to Wise to pay.

## How we built it

- **Frontend:** React.
- **Backend:** Node.js and Express, with PostgreSQL. The budget maths (date overlap, the hidden ceiling, feasibility, splits, settle-up and pacing) is pure, deterministic code with 75 unit tests.
- **Wise API** for exchange rates. Every expense stores the rate, its source and the time, and fallback rates are always labelled.
- **SerpApi (Google Flights)** for live flight prices from each member's own airport, cached and budgeted against our monthly search limit.
- **Gemini API** with structured JSON output for receipts and spoken expenses. A lighter fallback model takes over when the main one is busy. Amounts are converted to minor units in our code, not by the model.
- **ElevenLabs** Scribe v2 for speech-to-text and Eleven v4 Turbo for the spoken confirmation.
- **Snowflake** as an anonymised analytics warehouse, with a Streamlit dashboard and the "past groups spent about €X a day" figure. Cortex writes "why this fits" reasons when the account allows it.
- **Tiger Data:** an optional script turns past-group spending into a hypertable with a continuous aggregate.

AI never sees a budget. Gemini gets receipt images, transcripts and member names only, and Cortex gets destination tags, nights and month only.

## Challenges we ran into

- **Keeping budgets private without making the app useless.** Every response is built from an explicit list of fields, and when a live flight price knocks out an option, the group isn't told whose flight caused it.
- **Splitting a receipt fairly.** Item prices rarely add up exactly to the total once tax, tip and discounts are in. We split the total in proportion to each person's items, using integer minor units and largest-remainder rounding so the shares always add up.
- **Currencies everywhere.** NGN isn't supported by Google Flights, so those searches run in EUR and are converted with Wise rates. Zero-decimal currencies needed their own handling.
- **API limits during a 24-hour build.** Gemini returned "high demand" errors, so we added a fallback model. SerpApi's free plan has 250 searches a month, so we cache prices and keep a reserve. Snowflake Cortex isn't available on trial accounts, so the app falls back to a template reason.
- **Merging two people's work at 3am.** The Gemini and voice branch and the main branch both changed the expenses code, and we had to merge them carefully.

## Accomplishments that we're proud of

- A group really can go from "no plan" to a booked destination without anyone stating a budget.
- Receipt scanning that splits by item, and voice entry that understands "Amara had the pasta", with a spoken confirmation.
- Settling up across GBP, NGN and EUR without anyone doing currency maths.
- Every fallback is labelled with its source, so the app stays honest when a provider is down.

## What we learned

- Privacy has to be designed into what the server returns, not just hidden in the UI.
- AI works best at the edges: reading messy input and speaking back. The money maths is better left to deterministic, tested code.
- Using structured output with a strict schema made Gemini much easier to rely on.

## What's next for Budget Group Trip Planner

- A re-planning agent that reacts when a flight price jumps, a stay sells out or someone drops out.
- Private "would you stretch slightly above your number?" prompts sent to everyone at once, before the group hears that nothing fits.
- Two-track days: a shared core plan plus optional extras people join privately.
- Stay search and voting, then Trip Wrapped, a shareable recap with group totals only.
- A deeper Wise integration, so settling up happens inside Wise.

## AI disclosure

See the [AI disclosure section in the README](../README.md#ai-disclosure). In short: Gemini, ElevenLabs and Snowflake Cortex are features inside the app. While building, we used Claude Code as a coding assistant for the Gemini receipt integration and item splitting, voice entry and read-back, and resolving merge conflicts. Claude helped structure and edit our docs and Devpost text, and Canva AI laid out the slides. The product idea, privacy rules and budget logic are our own, and we tested and reviewed everything AI helped with.
