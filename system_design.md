# Budget Group Trip Planner – System Design

How we're building the app and why. The backlog in `internal-team-doc.md` covers *what* we're building and in what order; this doc covers *how* each part works. Exact request and response formats are in `api-contract.md`.

---

## 1. Goals and non-goals

**Goals**
- A group can agree on a trip without anyone seeing anyone else's budget.
- Every number shown to a user is either their own private data or a group outcome that reveals nothing about individuals.
- Money maths is deterministic, testable and in the right currency.
- AI is used for reading and writing (receipts, speech, explanations), never for budget decisions.

**Non-goals for the hackathon**
- Real booking or payments inside the app. We hand off to booking sites and Wise.
- Full account system with passwords.
- Live flight and hotel prices. We use sample data stored in the database, labelled as such.

---

## 2. Architecture

```
 React frontend
   │  every request carries a JWT identifying the user
   ▼
 Express API ── auth middleware sets req.user
   │
   ├── routes/        thin: validate input, call services, shape the response
   ├── services/      read/write the database, call logic and integrations
   ├── logic/         pure functions, no DB or network (easy to unit-test)
   └── integrations/  Wise, Gemini, ElevenLabs, each with a fallback
   │
   ▼
 PostgreSQL on Tiger Data (expenses as a hypertable)
```

We're splitting it this way so the rules that protect privacy and money sit in one place (`logic/` and `services/`) where we can test them. Routes stay thin, which makes it easy to see what each endpoint returns. Integrations are kept separate, so if Gemini or Wise goes down, only that feature is affected.

**Deployment:** one Vultr server. Express serves both the built React app and the API from the same origin, so we don't have to deal with CORS. Our GoDaddy domain points at it.

---

## 3. Key design decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where privacy is enforced | In server code: every private query is filtered by `req.user.id`, and responses are built from explicit field lists | Hiding fields in the UI isn't privacy. We won't mention row-level security in the pitch unless we actually build it. |
| Auth | Invite code + name → signed JWT. Demo has a user switcher. | Fast to build, still identifies the user on every request. |
| Money storage | Integers in minor units (pence, cents, kobo) as `BIGINT` | Floats cause rounding errors in splits. |
| Currencies | Each person's values stored in their own currency. Comparisons happen in the group's base currency (EUR). | Lets Maya think in GBP and Daniel in NGN, while the maths stays consistent. |
| Exchange rates | Wise rate, cached; every expense stores the rate, source and time used | Settlement is reproducible and transparent. |
| AI boundary | AI receives tags, receipts, transcripts and filtered options, never budgets | Budget decisions stay deterministic and private. |
| Sample data | Stored in real tables with `is_sample = true`, labelled in the UI | Real queries, honest labelling, avoids "hardcoded shortcuts". |

---

## 4. Database design

The tables fall into five groups. Each group answers one question.

### 4.1 Who is in the trip?
- **`users`**: name, home currency, nationality, home airport. Home currency decides how amounts are shown to this person.
- **`groups`**: invite code, base currency (EUR), and status (`planning`, `trip`, `settled`). Status drives which screens are available.
- **`group_members`**: joins users to groups. A user could be in several groups.

### 4.2 What does each person want and can afford? (private)
- **`private_inputs`**: three budgets per person per group (flight, group, personal), the currency they entered them in, and `stretch_ok` (their answer to "accept slightly above your number?"). **This is the most sensitive table.** Only the owner's row is ever returned, and only the logic layer reads all rows.
- **`availability`**: date ranges each person is free, plus min and max nights.
- **`preferences`**: trip-style tags and dietary needs. These are safe to send to Gemini because they contain no money.

### 4.3 What options exist? (sample data)
- **`destinations`**: city, tags, typical stay cost per person per night, typical food cost per person per day.
- **`flight_estimates`**: price from each origin airport to each destination.
- **`activities`**: name, price, tags, per destination.
- **`stays`**: name, area, rating, price per person per night, and `available` (the agent scenario flips this to false).

All prices here are stored in EUR, since they're reference data rather than anyone's own money.

### 4.4 What did the group decide?
- **`votes`**: one row per person per option. `target_type` lets the same table hold destination, stay and activity votes. Only totals are ever returned.
- **`trips`**: the chosen destination, stay and dates.
- **`trip_activities`**: activities on the plan, marked `core` (everyone, paid from the group budget) or `optional`.
- **`activity_optins`**: who joined each optional activity. This decides who shares its cost.

### 4.5 What was spent?
- **`expenses`**: amount and currency as paid, the rate to EUR at that time, the rate's source, the type (`shared`, `extra`, `personal`) and how it was entered (`manual`, `receipt`, `voice`).
- **`expense_participants`**: who shares each expense. Personal expenses have only the payer.
- **`fx_rates`**: cached rates with source and time, so we don't call Wise on every request and can fall back when it's down.
- **`nudges`**: which evening nudges were sent and answered.

### 4.6 Tiger Data features we use
- **`expenses` is a hypertable** partitioned on `spent_at`. Tiger Data needs unique keys on hypertables to include the time column, so our primary key is `(id, spent_at)`. We'll double-check this in their docs when we set it up.
- **A continuous aggregate** of spend per group per day. It powers the pacing message, the spending chart, and the "groups spent about €X per day here" figure on the shortlist.

### 4.7 Relationships at a glance

```
users ─┬─ group_members ─── groups ─── trips ─── trip_activities ─── activity_optins
       ├─ private_inputs ───┘           │
       ├─ availability ─────┘           ├── destinations ── activities, stays, flight_estimates
       ├─ preferences ──────┘           │
       └─ votes ────────────┘           │
groups ─── expenses ─── expense_participants ─── users
```

---

## 5. Core logic

All of these are pure functions in `backend/src/logic/`, tested with fixed inputs.

**Date overlap.** Intersect everyone's free ranges. Keep windows at least as long as the largest `min_nights`, cap at the smallest `max_nights`, and return up to three windows.

**Ceiling.** Convert every group budget to EUR. The ceiling is `lowest + min(10% of (highest − lowest), 10% of lowest)`. Anyone whose budget is below the ceiling is asked privately whether they accept slightly more; if they say no, the ceiling drops to their budget. The ceiling never leaves this function.

**Feasibility.** For each destination and date window, an option fits only if all three checks pass for every member:
1. their flight estimate is within their flight budget;
2. the shared cost per person (stay × nights + core activities) is within the ceiling;
3. the food estimate (food per day × nights) is within their personal budget.

Options are ranked by the smallest margin across all members, so the top options are the ones where nobody is stretched. Return 3–5, labelled "fits everyone".

**No match.** If nothing fits, every member gets a private prompt at the same time. Members whose own budget or dates are limiting get specific suggestions; everyone else gets general ones. After 24 hours (or a demo button), the group sees a neutral message.

**Budget plan.** Once a trip is chosen: group view = shared cost per person. Private view = committed to shared costs, food estimate, optional activities joined, and what's left. Recalculated whenever votes or opt-ins change.

**Pacing.** Daily allowance = (personal budget − personal and extra spend so far) ÷ days left. Compare with today's spend to produce a message and an over/under flag.

**Settlement.** Compute each person's net balance in EUR from shared and extra expenses. Repeatedly match the largest debtor with the largest creditor until all balances are zero. This gives a small number of payments. Convert each payment into the payer's home currency at the latest stored rate and show the rate and its source.

---

## 6. Privacy model

| Data | Who can see it |
| --- | --- |
| Your three budgets, dates, stretch answer | You only |
| Your private breakdown and pacing | You only |
| Shortlist, shared cost per person, vote totals | Whole group |
| Who joined an optional activity | Whole group (still to confirm as a team) |
| Shared and extra expenses | Participants |
| Personal expenses | You only |
| Ceiling, who is limiting, raw budgets of others | Nobody; never leaves the server |

**Less obvious leaks we need to watch for**
- Error messages that name a person or a number ("Maya's budget is too low").
- Prompts sent only to the limiting person. Send prompts to everyone at once.
- Showing the most expensive option right at the ceiling. Show options well under it, never sorted by price descending.
- Groups of two, where budgets can be inferred. Show a warning before they start.

---

## 7. External integrations

| Service | Used for | Input | Output | If it fails |
| --- | --- | --- | --- | --- |
| Wise | Exchange rates, payment handoff | Currency pair | Rate | Use last cached rate, labelled "cached" with its time |
| Gemini | Receipt parsing, voice parsing, option reasons, itinerary, agent | Image, transcript, tags, filtered options | Structured JSON | Manual entry form; generic reason text |
| ElevenLabs | Speech-to-text for expenses, reading nudges aloud | Audio / text | Transcript / audio | Typed input; text nudge |
| Tiger Data | Database, hypertable, continuous aggregate | SQL | Rows | Core of the app; no fallback needed |

**Every AI output is a draft.** Parsed receipts and spoken expenses are shown for confirmation before saving.

**The adaptive agent** handles one scenario: the chosen stay becomes unavailable. Gemini can call two tools we write: `findStays(destination, dates)` and `checkFits(stayId)`. `checkFits` runs our feasibility logic and returns only `fits` or `doesn't fit`. The agent proposes a replacement and explains why; the user confirms.

---

## 8. Demo data and reset

Our seed creates Maya (London, GBP), Daniel (Lagos, NGN) and Sofia (Madrid, EUR) with deliberately different budgets and partly overlapping dates, plus 8 destinations with flights from all three airports, activities and stays. A reset script puts the seed back in seconds, so we can run the demo as many times as we need.