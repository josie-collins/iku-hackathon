# Wise Piggy: System Design

This document explains how Wise Piggy works and why we made the design choices we did. It reflects the state of the project at the end of the hackathon on 18 October 2026. The exact request and response formats are in [api_contract.md](api_contract.md), and our build plan is in [internal_plan.md](internal_plan.md).

---

## 1. What we were aiming for

**Goals**

- Let a group plan a trip without anyone having to reveal their budget to other members.
- Make sure every number a person sees is either their own private data or a group result that doesn't reveal anyone else's information.
- Keep all financial calculations accurate, tested and in the correct currency.
- Use AI to help with reading and speaking, including receipts, voice input and short explanations, without letting it make financial decisions.

**What we deliberately left out**

- Booking trips or making payments directly in the app. Payments are handled through Wise.
- Accommodation search, day-by-day itineraries and the re-planning agent (see Section 10).

---

## 2. The big picture

```text
React frontend (code/frontend/src)
  │  Account: trips, budgets, shortlist, voting · Trip: expenses, pace, settle-up
  │  Friends · Notifications · Insights
  │  Every request includes a login token (JWT) to identify the user
  ▼
Express API (code/backend)
  ├── session.js, auth.js       Handles sign-up and login using scrypt password hashes; middleware sets req.user
  ├── route files               Account, budgets, trips, booking, expenses, friends,
  │                             notifications, explore (insights), rates
  ├── shortlist.js              Recalculates "fits everyone" whenever budgets or group members change
  ├── flightQuotes.js           Fetches live flight prices for shortlisted destinations in the background
  ├── explanations.js           Requests "why this fits" explanations from Cortex in the background
  ├── insights.js               Shows "past groups spent about X a day": Snowflake first, PostgreSQL as a fallback
  ├── gemini.js                 Handles receipt scanning and spoken expenses
  ├── logic/                    Core calculations: plain functions with no database or network access, covered by unit tests
  └── integrations/             Connects to Wise, flights (SerpApi), ElevenLabs and Snowflake
  │
  ├──▶ PostgreSQL               Stores all application data
  └──▶ Snowflake                Stores an anonymised copy for analytics and powers a Streamlit dashboard
```

The privacy rules and financial calculations live in `logic/` and `shortlist.js`, where our tests can check them directly. Each external service has its own integration file and fallback, so if one provider goes down, only the feature that depends on it is affected.

For local development, `npm run dev` (`code/scripts/dev.js`) installs the packages, creates a `.env` file with a random `JWT_SECRET` if one doesn't already exist, and starts the backend and React development server together. In production, the backend serves the built React app itself, so everything runs through a single process. See Section 9 for more details.

---

## 3. Decisions we made and why

| Decision | What we chose | Why |
| --- | --- | --- |
| Where privacy is enforced | On the server. Every private query is filtered by `req.user.userId`, and every response is built from an explicit list of fields. The `v_member_public` view only exposes public member details. | Hiding a field in the UI doesn't make it private. We also don't claim to use database row-level security. |
| Logging in | Username and password using scrypt, with a signed token that lasts 7 days. An incorrect username takes just as long to reject as an incorrect password. | We needed real accounts for friends without allowing people to check which usernames exist. |
| Storing money | Whole numbers in minor units, such as pence, cents and kobo, stored as `BIGINT`. | Decimal calculations can introduce rounding errors when splitting bills. |
| Currencies | Each person's budget stays in their home currency. Comparisons use the group's base currency, which is set by the organiser. | Tom thinks in pounds and Amara in naira, but we need one currency to compare everyone's budgets consistently. |
| Exchange rates | Wise rates, cached for an hour. Every expense records the rate, its source and when it was retrieved. | This makes it possible to see how a settlement was calculated and ensures the same expense can be worked out consistently. |
| Keeping AI away from budgets | `gemini.js` doesn't import the database at all. The input for Cortex is built by `explanationInput()`, which removes all money, names and IDs. | This prevents budgets from accidentally reaching an AI model. |
| Trusting AI output | Anything Gemini reads or generates stays a draft until the user confirms it. Our code converts amounts into minor units rather than leaving that task to the model. | Users stay in control, and the financial calculations remain accurate. |
| Sample data | Destinations, reference prices and past-group spending are stored in real tables and retrieved with real queries. They're labelled as sample data in the app. | We wanted to be transparent about what's sample data without relying on hardcoded shortcuts. |

---

## 4. The database

The database tables are defined in `code/backend/db/schema.sql`, and the sample data lives in `seed.sql`. Running `npm run db:reset` rebuilds the tables and reloads the sample data.

| Question | Tables |
| --- | --- |
| Who is on the trip? | `users`, `friendships`, `groups` (status, base currency, trip dates and the demo's `current_day`), `group_members` (role, trip styles, minimum and maximum nights) |
| What can each person afford? **Private.** | `budgets` (flight, group, private daily budget, currency and `accepts_stretch`), `availability` |
| What options are available? | `destinations` (sample costs, tags and photos), `flight_estimates` (sample prices), `flight_quotes` (cached live SerpApi prices) |
| What did the group decide? | `destination_options` (the shortlist and its Cortex summary), `votes`, `resolution_rounds`, `resolution_prompts` |
| What was spent? | `expenses` (amount paid, amount in the base currency, rate source and time, type, category and trip day), `expense_participants` (each person's share), `settlements` |
| What happened during the trip? | `trip_activity`, `notifications`, `daily_checkins` |
| How much did past groups spend? | `sample_trip_spend` |

**About Tiger Data**

We wrote `code/backend/db/timescale.sql` to turn `sample_trip_spend` into a TimescaleDB hypertable, with a continuous aggregate showing spending per destination per day. We didn't get to run it on a Tiger Data instance, and the app doesn't depend on it. When using standard PostgreSQL, `db:reset` skips this step, and the app calculates the same averages using a regular query.

---

## 5. The maths (`code/backend/logic/`)

**Finding dates (`dates.js`)**

We combine each person's available date ranges, find the dates that overlap for everyone, and keep only the windows that are long enough for the group's minimum number of nights.

**The group ceiling (`ceiling.js`)**

We convert everyone's group budget into the base currency and calculate the ceiling using:

`ceiling = lowest + min(10% of (highest − lowest), 10% of lowest)`

If someone's budget falls below that ceiling, they must have agreed to stretch their budget. Otherwise, the ceiling drops to their budget. We haven't built the screen for answering the stretch question yet, so the ceiling currently defaults to the lowest budget.

**Does an option fit? (`feasibility.js`)**

A destination only fits if every member's flight is within their flight budget, the estimated daily food cost is within their private daily budget, and the shared cost per person stays within the group ceiling.

We choose the trip length so that the shared cost stays at or below 90% of the ceiling. This gives us a buffer rather than letting a price sit right on someone's limit. If no destinations fit, the trip's status changes to `resolving`, and everyone sees the same neutral message. The server keeps the details of whose budget rules out which options private.

**Live flights (`flights.js` and `flightQuotes.js`)**

We first build the shortlist using sample flight prices. We then fetch live return-flight prices, but only for the routes the shortlist actually needs. Prices are cached for 12 hours, and we keep some monthly searches in reserve. If a live price pushes an option over someone's flight budget, we remove that option without revealing whose flight caused it.

**Currency conversion (`fx.js`)**

All conversions use minor units. The logic also handles currencies with no decimal places, such as JPY, and currencies with three decimal places.

**Expenses (`expenses.js`)**

- `splitEvenly`: Any leftover pennies are distributed one at a time among the first few people, so the shares always add up to the original total.
- `weightsFromItems` and `splitByWeights`: When splitting a receipt, each person's share is weighted by the cost of their items, with shared items divided evenly. We then split the full total, including tax and tip, in proportion to those weights, using the largest-remainder method to handle rounding.
- `computeBalances` and `settleUp`: We calculate everyone's net balance. The person who owes the most pays the person who is owed the most, and we repeat until all balances reach zero. This keeps the number of payments as low as possible. Each payment is displayed in the payer's home currency.
- `pace`: We compare your private daily budget multiplied by the number of days elapsed with your share of food, extras and personal spending.

**Analytics (`analytics.js`)**

This builds the anonymised data sent to Snowflake. It uses salted-hash trip IDs, includes shared and extra spending only, and excludes trips with fewer than three people.

**Explanations (`explain.js`)**

This prepares the money-free input and prompt for Cortex, rejects any response that mentions money, and provides a template explanation if the AI-generated one can't be used.

---

## 6. Who can see what

| Data | Who can see it |
| --- | --- |
| Your three budgets and availability dates | Only you |
| Your flight price for each option | Only you |
| Your spending pace | Only you |
| The shortlist and vote totals | The whole group |
| Shared and extra expenses | The whole group |
| Personal expenses | Only you |
| The group ceiling, whose budget is limiting the group, and other people's budgets and votes | Nobody. This information never leaves the server. |
| Snowflake data | Only anonymised trips with three or more people |

**Less obvious privacy leaks we watch out for**

- Error messages that might reveal a person's name or a budget amount.
- A destination disappearing after a live flight price comes in. The group isn't told whose flight caused it.
- The most expensive option sitting exactly at the ceiling, which could reveal the limit. That's why we leave 10% of headroom.
- Groups of two, where one person might work out the other's budget. Both people see a warning first.

---

## 7. Outside services

| Service | What it does for us | What we send it | What happens if it fails |
| --- | --- | --- | --- |
| Wise (sandbox) | Provides exchange rates and the "Pay with Wise" link | Currency pairs | We use the last valid Wise rate, then a fixed fallback table. Fallback rates are always labelled. |
| SerpApi (Google Flights) | Provides live flight prices | Airports and dates | We use sample prices. Google Flights doesn't support NGN, so those searches run in EUR and are converted. |
| Gemini | Reads receipts and processes spoken expenses | The receipt photo, or the transcript and the trip members' names | A lighter fallback model is used when the service is busy (429/503 errors), followed by manual entry if needed. |
| ElevenLabs | Handles speech-to-text (`scribe_v2`) and spoken confirmations (`eleven_v4_turbo`) | The recording, which automatically stops after 30 seconds, and the confirmation sentence | Users can enter expenses by typing instead, without audio. |
| Snowflake | Stores analytics, powers the Streamlit dashboard and generates Cortex explanations | Anonymised rows, plus tags, styles, nights and month | PostgreSQL provides the numbers, and a template provides the explanations. Cortex isn't available on trial accounts. |

---

## 8. Demo data

`seed.sql` creates three example users: Tom (London, GBP), Amara (Lagos, NGN, vegetarian) and Lucia (Madrid, EUR). Each has a different budget and availability dates that partly overlap.

The seed data also includes additional users, 12 destinations with photos, sample flight prices and past-group spending. Everyone's password is `demo1234`. Running `npm run db:reset` restores everything in a few seconds.

---

## 9. Hosting

The live app is available at https://wisepiggy.club and runs on a Vultr Ubuntu 24.04 server.

```text
Browser ──HTTPS──▶ Caddy (ports 80/443, automatic certificates)
                     │
                     ▼
                   Node (Express) on localhost:8080 ── managed by systemd, restarted if it crashes
                     ├── /api/...         The API
                     └── everything else  The built React app (code/frontend/build)
                     │
                     ▼
                   PostgreSQL on the same server
```

- **One process.** When `code/frontend/build` exists, the backend serves it directly. The browser uses a single origin, so we don't need to deal with CORS.
- **HTTPS.** Caddy automatically obtains and renews certificates. The firewall only allows SSH, HTTP and HTTPS, so port 8080 can't be accessed from outside.
- **Secrets.** These live in `code/backend/.env` on the server and are copied there manually, never committed to git.
- **The domain.** The `.club` domain is from GoDaddy Registry and was purchased through Porkbun. Its `A` records for the main domain and `www` both point to the server.
- **Deployment scripts.** `deploy/setup-server.sh` prepares a new server, while `deploy/deploy.sh` builds the app and restarts it. The README contains the full setup instructions.

---

## 10. Not built yet

- **Re-planning agent:** Responds to a sudden price increase, accommodation selling out or someone dropping out of the trip.
- **The stretch question and private-first prompts:** The database tables and logic are in place, but the endpoints and screens haven't been built yet.
- **Two-track days:** A shared core itinerary with optional extras, a budget-plan view and day-by-day itineraries.
- **Accommodation search and voting.**
- **Trip Wrapped:** A shareable trip recap that shows group totals without revealing individual spending.
