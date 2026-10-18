# Budget Group Trip Planner

**Transparent costs, private budgets.** A group trip planner where nobody has to say their budget out loud.

Built in 24 hours at the [IKU Womxn in STEM Hackathon](https://iku-womxn-in-stem-hackathon.devpost.com/) (17–18 October 2026) by Eva Stamatovska and Josie Collins.

**Main track:** Wise – Max Ease. **Side challenges:** ElevenLabs, MLH Best Use of Gemini API, MLH Best Use of Snowflake API, MLH Best Use of Tiger Data.

## The problem

Group trips stall on one awkward question: "What's everyone's budget?" People from different financial backgrounds, especially newer friends, don't want to answer. They overspend, stay quiet, or drop out.

It gets worse when friends live in different countries. Flights cost each person a different amount, everyone thinks in a different currency, and shared costs end up scattered across chat messages and forgotten receipts.

## What it does

Each person privately enters a budget. Only the server ever reads it. The app finds trips that fit everyone, the group votes anonymously, and on the trip everyone logs expenses by receipt photo or voice. At the end, everyone settles up in their own home currency through Wise.

**Planning**

- **Private budgets.** Each member enters three numbers in their home currency: flights, their share of group costs, and a private daily budget for food and extras. Nobody else ever sees them.
- **Hidden group ceiling.** The server works out how much the group can spend on shared costs: `lowest + min(10% of (highest − lowest), 10% of lowest)`. The ceiling is never sent to any client.
- **Date overlap.** Everyone marks when they're free. The server finds the windows that work for all of them.
- **"Fits everyone" shortlist.** A destination only appears if, for every member, the flight, the shared cost and the daily food estimate are each within that person's own budget. Options are kept below the ceiling, so no price sits right at anyone's limit.
- **Live flight prices** from SerpApi (Google Flights) for each member's own departure airport. If a live price pushes an option over someone's flight budget, the option quietly disappears.
- **"Past groups spent about €X a day here"**, from anonymised trip data in Snowflake, with Postgres as the fallback.
- **Anonymous voting and booking.** Everyone sees vote totals only, never who voted for what.
- **No-match message.** If nothing fits, the group sees "No trip fits everyone yet" with neutral suggestions. It never says whose budget is the limit.
- **Two-person warning.** In a group of two, budgets can be roughly worked out, so both people are warned before they enter one.

**On the trip**

- **Receipt scanning.** Snap a receipt and Gemini reads the total, currency, merchant, category and every item line. Tap who had each item, and the bill is split by what each person actually had.
- **Voice entry.** Say "I paid 42 euros for dinner, Amara had the pasta for twelve". ElevenLabs transcribes it, Gemini turns it into a draft expense with items and people, and you confirm it. ElevenLabs then reads back what was saved, for example "Saved €42 for Dinner. Amara owes you €12."
- **Shared, extra or personal.** Shared costs are split between everyone in them. Personal ones are visible only to the person who paid.
- **Live Wise exchange rates.** Each expense saves the rate, source and time used. If Wise can't be reached, the app uses fallback rates and labels them as such.
- **Private pace.** Each person sees a line only they can see, such as "You're €18 under your daily pace."
- **Simulate next day**, so the demo can move through the trip.
- **Notifications** when someone adds an expense you're part of.

**Settling up**

- **Fewest payments.** The app works out who owes whom, converts each payment into the payer's home currency and links to Wise.

**Also:** accounts with passwords, friends and friend requests, and an Insights tab showing spending by city and month.

## Privacy rules

No member's budget, the ceiling, or who is limiting the group ever leaves the server.

- Every private query is filtered by the logged-in user, and responses are built from explicit field lists. Hiding fields in the UI isn't privacy.
- The ceiling and the "who blocks what" diagnostics stay inside the shortlist function (`code/backend/shortlist.js`, `code/backend/logic/feasibility.js`).
- Votes return totals only. Personal expenses are only returned to the person who paid.
- **AI never sees a budget.** Gemini receives receipt images, transcripts and member names only. Snowflake Cortex receives destination tags, trip styles, nights and month only, and any reply that mentions money is thrown away. `code/backend/gemini.js` deliberately doesn't import the database.
- Snowflake only holds anonymised data: hashed trip ids, no names, no budgets, no personal spending, and no trips with fewer than 3 people.
- Leaving a trip deletes your budget and dates and recomputes the shortlist for everyone else.

## How it's built

```
React (code/frontend)
   │  JWT on every request
   ▼
Express API (code/backend)
   ├── *.js            routes: trips, budgets, booking, expenses, friends, notifications, insights
   ├── logic/          pure functions, unit-tested: dates, ceiling, feasibility, fx, expenses, flights, analytics, explain
   └── integrations/   Wise, SerpApi flights, ElevenLabs, Snowflake (+ gemini.js), each with a fallback
   │
   ▼
PostgreSQL (Tiger Data–ready)        Snowflake (anonymised analytics + Streamlit dashboard)
```

| Part | What we use | If it fails |
| --- | --- | --- |
| Budget maths: ceiling, feasibility, dates, pacing, splits, settle-up | Our own code in `code/backend/logic/` | Deterministic, no fallback needed |
| Database | PostgreSQL. `code/backend/db/timescale.sql` adds a Tiger Data hypertable and continuous aggregate | — |
| Exchange rates | Wise API (sandbox) | Fallback rates, labelled in the UI |
| Flight prices | SerpApi Google Flights, cached for 12 hours | Sample flight estimates from the database |
| Receipt and voice parsing | Gemini (`gemini-3.8-flash`, falls back to `gemini-3.5-flash-lite` when busy) | Manual entry form |
| Speech-to-text and read-back | ElevenLabs `scribe_v2` and `eleven_v4_turbo` | Typed entry; no audio |
| Destination insights | Snowflake (`npm run snowflake:sync`), dashboard in `code/snowflake/streamlit_app.py` | Same calculation in Postgres |
| "Why this fits" reasons | Snowflake Cortex | Template reason. Cortex isn't available on trial accounts, so the demo uses the template. |

More detail: [docs/system_design.md](docs/system_design.md) and [docs/api_contract.md](docs/api_contract.md).

## Running it

You need Node 18.11+ (20+ recommended) and a PostgreSQL database.

```bash
npm run setup      # installs packages, creates code/backend/.env from .env.example
# fill in DATABASE_URL (and any API keys) in code/backend/.env
npm run db:reset   # creates the tables and loads the sample data
npm run dev        # backend on :8080, frontend on :3000
```

Demo users are `tom` (London, GBP), `amara` (Lagos, NGN) and `lucia` (Madrid, EUR). All the API keys are optional: without one, that feature uses its fallback.

Other commands: `npm run snowflake:sync`, `npm run flights:refresh`, and `npm --prefix code/backend test` for the unit tests.

**Sample data.** Destinations, reference prices and past-group spending are seeded sample data in real tables, read through real queries, and labelled "sample" where they're shown. Destination photos are from Wikimedia Commons: see `code/frontend/public/images/destinations/CREDITS.md`.

## AI disclosure

We used AI in two ways: as a **feature inside the app** at runtime, and as a **coding and writing assistant** while we built it. Everything else is our own work.

### AI inside the app

| Feature | AI used | What we built ourselves |
| --- | --- | --- |
| Receipt reading: total, currency, merchant, category and item lines | Gemini API | The prompt, the JSON schema, validation, conversion to minor units in code (not by the model), the fallback model, and the manual-entry fallback |
| Spoken expenses: transcript to draft expense with items and people | ElevenLabs speech-to-text, then Gemini | The prompt, matching names to user ids in code, and the confirm step. Nothing is saved until the user confirms. |
| Spoken confirmation after saving | ElevenLabs text-to-speech | The confirmation sentence is built by our code from the saved split |
| "Why this fits" reasons | Snowflake Cortex (falls back to our template on trial accounts) | The money-free prompt input and the filter that rejects replies mentioning money |

AI never decides anything about money. Every budget check, split, conversion and settlement is deterministic code with unit tests.

### AI as a development tool

| Area | AI tool | How we used it | What we did ourselves |
| --- | --- | --- | --- |
| Product idea, problem, privacy rules, budget logic design | None | — | Our own idea, refined with input from people at Wise |
| Gemini receipt integration and per-item split | Claude Code | Helped write the Gemini call and schema, the proportional-split maths and the item editor | Designed the feature, tested it on real receipts, reviewed and debugged the code |
| Voice entry and spoken read-back | Claude Code | Helped write the ElevenLabs calls, the transcript prompt and the browser recording | Chose the models and flow, tested it by voice |
| Merging branches | Claude Code | Helped resolve merge conflicts | Reviewed every resolution and checked the app still ran |
| Docs, README, Devpost text and pitch deck | Claude, Canva AI | Claude helped structure and edit the writing; Canva AI laid out the slides | Decided the content and every claim, reviewed everything |

Everything else, including the budget, ceiling and settle-up logic, the database, and the Wise, flights and Snowflake integrations, we wrote and tested ourselves.

## What's next

- A re-planning agent that reacts when a flight price jumps, a stay sells out or someone drops out
- A screen to answer the private "stretch slightly above your number?" prompt (the logic already supports it)
- Private-first resolution: a private prompt to every member at once before the group hears "nothing fits"
- Two-track days: a shared core plan plus optional extras people join privately
- Stay search and voting, with Booking.com and Airbnb links
- Trip Wrapped: a shareable recap with group totals only
- Hosting on Vultr with our own domain
