# Budget Group Trip Planner – System Design

How the app works and why, as built (updated 18 Oct 2026). Exact request and response formats are in [api_contract.md](api_contract.md). The build plan is in [internal_plan.md](internal_plan.md).

---

## 1. Goals and non-goals

**Goals**
- A group can agree on a trip without anyone seeing anyone else's budget.
- Every number shown to a user is either their own private data or a group outcome that reveals nothing about individuals.
- Money maths is deterministic, tested, and in the right currency.
- AI is used for reading and speaking (receipts, speech, short reasons), never for budget decisions.

**Non-goals for the hackathon**
- Real booking or payments inside the app. We hand off to Wise.
- Stay search, itineraries and the re-planning agent (see section 9).

---

## 2. Architecture

```
 React frontend (code/frontend/src)
   │  Account (trips, budgets, shortlist, voting) · Trip (expenses, pace, settle-up)
   │  Friends · Notifications · Insights
   │  every request carries a JWT identifying the user
   ▼
 Express API (code/backend)
   ├── session.js, auth.js       signup/login (scrypt hashes), JWT middleware sets req.user
   ├── route files               account, budgets, trips, booking, expenses, friends,
   │                             notifications, explore (insights), rates
   ├── shortlist.js              recompute "fits everyone" when budgets or members change
   ├── flightQuotes.js           live flight prices for the shortlist, in the background
   ├── explanations.js           Cortex "why this fits" reasons, in the background
   ├── insights.js               "past groups spent about X a day", Snowflake → Postgres fallback
   ├── gemini.js                 receipt and transcript parsing
   ├── logic/                    pure functions, no DB or network, unit-tested
   └── integrations/             wise, flights (SerpApi), elevenlabs, snowflake
   │
   ├──▶ PostgreSQL               app data; timescale.sql makes it Tiger Data–ready
   └──▶ Snowflake                anonymised analytics copy, Streamlit dashboard
```

The rules that protect privacy and money sit in `logic/` and `shortlist.js`, where they're tested. Each integration is its own file with its own fallback, so if one provider is down only that feature degrades.

`npm run dev` (`code/scripts/dev.js`) installs packages, creates `.env` with a random `JWT_SECRET`, and runs both servers.

---

## 3. Key design decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where privacy is enforced | In server code: every private query is filtered by `req.user.userId`, and responses are built from explicit field lists. `v_member_public` exposes only public member fields. | Hiding fields in the UI isn't privacy. We don't claim row-level security. |
| Auth | Username and password (scrypt), signed JWT for 7 days. A wrong username takes as long as a wrong password. | Real accounts for the friends feature, without revealing which usernames exist. |
| Money storage | Integers in minor units as `BIGINT` | Floats cause rounding errors in splits. |
| Currencies | Each person's budget is in their home currency. Comparisons happen in the group's base currency (the organiser's). | Tom thinks in GBP and Amara in NGN, while the maths stays consistent. |
| Exchange rates | Wise rates, cached for an hour. Every expense stores the rate, source and time. | Settlement is reproducible and transparent. |
| AI boundary | `gemini.js` doesn't import the database. Cortex input is built by `explanationInput()`, which drops all money, names and ids. | Budgets can't reach a model by accident. |
| AI output | Every parsed receipt or voice note is a draft. Nothing is saved until the user confirms. Amounts are converted to minor units in our code, not by the model. | The user stays in control and the maths stays exact. |
| Sample data | Destinations, reference prices and past-group spend are real tables, read through real queries, labelled "sample". | Honest labelling without hardcoded shortcuts. |

---

## 4. Database

Schema: `code/backend/db/schema.sql`. Sample data: `seed.sql`. `npm run db:reset` rebuilds both.

| Question | Tables |
| --- | --- |
| Who is in the trip? | `users`, `friendships`, `groups` (status, base currency, trip dates, demo `current_day`), `group_members` (role, trip styles, min/max nights) |
| What can each person afford? **Private.** | `budgets` (flight, group, private daily, currency, `accepts_stretch`), `availability` |
| What options exist? | `destinations` (sample costs, tags, photo), `flight_estimates` (sample), `flight_quotes` (live SerpApi prices, cached) |
| What did the group decide? | `destination_options` (the shortlist and its Cortex summary), `votes`, `resolution_rounds`, `resolution_prompts` |
| What was spent? | `expenses` (amount as paid, amount in base currency, rate source and time, type, category, trip day), `expense_participants` (each person's share), `settlements` |
| What happened? | `trip_activity`, `notifications`, `daily_checkins` |
| Past groups | `sample_trip_spend` |

**Tiger Data.** `code/backend/db/timescale.sql` turns `sample_trip_spend` into a hypertable and adds a continuous aggregate of spend per destination per day. It's optional: the app computes the same averages with an ordinary query on plain Postgres.

---

## 5. Core logic (`code/backend/logic/`)

**Date overlap (`dates.js`).** Merge each person's free ranges, intersect everyone's, and keep windows long enough for the group's minimum nights.

**Ceiling (`ceiling.js`).** Convert every group budget to the base currency. `ceiling = lowest + min(10% of (highest − lowest), 10% of lowest)`. Anyone below it must have agreed to stretch, otherwise the ceiling drops to their budget. Nobody can answer the stretch question in the UI yet, so for now the ceiling is the lowest budget.

**Feasibility (`feasibility.js`).** An option fits only if, for every member: their flight is within their flight budget, the daily food estimate is within their private daily budget, and the shared cost per person is within the ceiling. Trip length is chosen to keep the shared cost at or below 90% of the ceiling, so prices never sit right at someone's limit. If nothing fits, the group status becomes `resolving` and everyone sees the same neutral message. The diagnostics on who blocks what are server-only.

**Live flights (`flights.js` and `flightQuotes.js`).** After the shortlist is built from sample estimates, live round-trip prices are fetched only for the routes it needs (cached for 12 hours, with a monthly search reserve). Any option a live price pushes over someone's flight budget is dropped, without saying whose.

**Exchange (`fx.js`).** Conversion on minor units, aware of zero- and three-decimal currencies.

**Expenses (`expenses.js`).**
- `splitEvenly`: leftover minor units go one each to the first people, so shares always add up.
- `weightsFromItems` and `splitByWeights`: for receipts, each person's weight is the sum of their items (shared items split evenly). The total, including tax and tip, is split in proportion to those weights, using the largest-remainder method.
- `computeBalances` and `settleUp`: net balance per person, then the largest debtor pays the largest creditor until everyone is at zero, which gives a small number of payments. Each payment is converted into the payer's home currency.
- `pace`: the private daily budget × days so far, compared with the person's share of food, extras and personal spending.

**Analytics (`analytics.js`).** Builds the anonymised rows for Snowflake: salted-hash trip keys, shared and extra spending only, and no trips with fewer than 3 people.

**Explanations (`explain.js`).** Builds the money-free Cortex input and prompt, rejects replies that mention money, and provides the template reason.

---

## 6. Privacy model

| Data | Who can see it |
| --- | --- |
| Your three budgets, your dates | You only |
| Your flight price per option | You only |
| Your pace | You only |
| Shortlist, vote totals | Whole group |
| Shared and extra expenses | Whole group |
| Personal expenses | You only |
| Ceiling, who is limiting, others' budgets and votes | Nobody. Never leaves the server. |
| Snowflake | Anonymised trips with 3+ people only |

**Less obvious leaks we guard against**
- Error messages that name a person or a number.
- An option disappearing after a live flight price: the group isn't told whose flight it was.
- The most expensive option sitting right at the ceiling (the 90% headroom).
- Groups of two, where budgets can be inferred: both people see a warning first.

---

## 7. External integrations

| Service | Used for | Sends | If it fails |
| --- | --- | --- | --- |
| Wise (sandbox) | Exchange rates, "Pay with Wise" link | Currency pairs | Last good Wise rate, then a static table. Always labelled `fallback`. |
| SerpApi (Google Flights) | Live flight prices | Airports and dates | Sample estimates. NGN is priced in EUR and converted, since Google Flights rejects NGN. |
| Gemini | Receipt and voice parsing | Receipt image, or the transcript plus trip member names | Lighter fallback model on 429/503, then manual entry |
| ElevenLabs | Speech-to-text (`scribe_v2`), spoken confirmation (`eleven_v4_turbo`) | The recording, and the confirmation sentence | Typed entry, no audio |
| Snowflake | Analytics warehouse, Streamlit dashboard, Cortex reasons | Anonymised rows; tags, styles, nights and month | Postgres for the numbers, template text for reasons. Cortex isn't on trial accounts. |

---

## 8. Demo data

`seed.sql` creates Tom (London, GBP), Amara (Lagos, NGN, vegetarian) and Lucia (Madrid, EUR) with different budgets and partly overlapping dates, plus more users, 12 destinations with photos, sample flights, and past-group spending. `npm run db:reset` restores it in seconds.

---

## 9. Not built yet

- **Re-planning agent** (incident.io track): reacts to a price jump, a sold-out stay or a dropout.
- **Stretch consent screen** and **private-first resolution prompts**. The tables and logic exist, but there are no endpoints or UI yet.
- **Two-track days** with optional extras, the budget-plan view, and itineraries.
- **Stay search** and voting.
- **Trip Wrapped.**
- **Hosting on Vultr** and a GoDaddy domain.
