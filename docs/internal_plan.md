# Budget Group Trip Planner – Internal Team Doc

Our working plan for the build, demo and pitch. This one stays internal, not on Devpost.

Related files:
- `system-design.md`: how the app works (architecture, database, logic, privacy)
- `api-contract.md`: exact request and response formats for every endpoint

**Key deadlines**
- Devpost draft started, with Wise as main track and side challenges selected: **Sat 17 Oct, 23:00**
- Final submission: **Sun 18 Oct, 12:15 BST** (aim to submit by 11:15)
- Live pitch: 3-minute demo + 2 minutes of Q&A

---

## A. The story we want judges to understand

### The scenario

Three friends want one trip, but have different budgets.

| Person | City | Situation |
| --- | --- | --- |
| Maya | London | Wants a weekend away but has a strict overall spending limit |
| Daniel | Lagos | Has a different departure airport, currency and travel budget |
| Sofia | Madrid | Can spend more, but wants the group to agree on a trip together |

### The problem

None of them wants to say, "I can't afford that." The group risks choosing a trip that excludes someone, or spends hours negotiating prices and dates.

### The payoff

They enter their limits privately, discover a trip that works for everyone, choose optional activities without awkward explanations, and split their expenses without manually converting currencies.

> The names, budgets and currencies are made up for the demo. It's an example story, so we shouldn't present it as testing with real users.

---

## B. The three-minute demo

The moment we want judges to remember is when **everyone's private information turns into one shared result**.

| Time | Step | Length | What happens |
| --- | --- | --- | --- |
| 0:00 | Open with the problem | 20s | "Planning a trip with friends is easy until everyone has a different budget. Usually, someone has to admit what they can't afford. We wanted to remove that conversation." |
| 0:20 | Show the private budgets | 35s | Enter or load three different budgets and availability windows. Show that each person sees only their own information, not their friends' limits. |
| 0:55 | Reveal the group shortlist | 35s | Show 2–3 feasible destinations, why they suit the group, and the anonymous vote. Explain that a deterministic matching function filters options against each member's private constraints. |
| 1:30 | The budget plan | 25s | After the vote, show the group's shared cost per person, then switch to one person's private breakdown (shared costs, food, left for extras). One person skips an optional activity; the group sees no reason, and their breakdown updates. |
| 1:55 | Log an expense with AI | 25s | Speak or scan a receipt, show the extracted amount and currency, confirm participants, save. Human confirmation before anything is recorded. Then show that person's private pacing update. |
| 2:20 | Settlement + one adaptive action | 25s | Show who owes whom, with conversions and rates clearly labelled. If time permits, simulate a hotel becoming unavailable and show the agent proposing a replacement. |
| 2:45 | Close on the value | 15s | "We're not just splitting the bill after the trip. We're helping people find a trip they can all comfortably say yes to." |

We don't need to show every feature. If the agent isn't reliable by feature freeze, we leave it out and keep the full flow from planning to settlement. **No optional feature is worth breaking the main story.**

---

## C. Backlog

**Already done:** React frontend, Node.js + Express backend, SQL schema, seeded dummy data.

**How we're working through it**
- We go top to bottom. When you're free, grab the next item whose dependencies are done and put your name in the Who column so we don't double up.
- Something only counts as done when its "done when" check passes.
- P0 = we need it for the demo. P1 = side challenges and nice extras. P2 = only if we have time.
- How each piece works is in `system-design.md`, and the exact data for each endpoint is in `api-contract.md`.

### Checkpoints

| Time | By then, the app can… |
| --- | --- |
| 19:00 | Run on Vultr; three demo users can log in; Devpost draft saved |
| 00:00 | Go from private budgets → shortlist → vote → budget plan |
| 05:00 | Log an expense, show pacing, show settlement |
| 08:30 | **Feature freeze.** Only bug fixes after this. |
| 11:15 | Submitted |

If we're behind at a checkpoint, we drop P2 items first, then P1. Rehearsal time stays no matter what.

### Epic 0: Setup

| ID | Item | P | Depends on | Done when | Who |
| --- | --- | --- | --- | --- | --- |
| 0.1 | Start the Devpost draft: Wise as main track, side challenges ticked | P0 | — | Draft saved before 23:00 | |
| 0.2 | Read `system-design.md` together and agree on the key decisions (section 3) | P0 | — | Both agree | |
| 0.3 | Finish `api-contract.md`: write the remaining endpoints in the worked-example format | P0 | 0.2 | Both have reviewed it | |
| 0.4 | Add `.env.example`, `.gitignore`, `dotenv`; no secrets in the repo | P0 | — | Fresh clone runs with a filled-in `.env` | |
| 0.5 | Create the Tiger Data database and connect the backend | P0 | 0.4 | Backend health route queries the DB | |
| 0.6 | Update the existing schema and seed to match `system-design.md` section 4 | P0 | 0.5 | Seed creates Maya, Daniel, Sofia, 8 destinations, flights, activities, stays | |
| 0.7 | Set up mock mode in the frontend (`api.js` + `mocks/` folder) | P0 | 0.3 | Screens can load mock data | |
| 0.8 | Join with invite code, JWT auth middleware, demo user switcher | P0 | 0.6 | Can switch between the three users; each request knows who's calling | |
| 0.9 | Deploy to Vultr: Express serves the React build | P0 | — | Public URL loads the app | |
| 0.10 | Register the domain with GoDaddy Registry and point it at Vultr | P1 | 0.9, name chosen | Domain loads the app | |

### Epic 1: Private planning

| ID | Item | P | Depends on | Done when | Who |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Wise exchange-rate module with cache and labelled fallback | P0 | 0.5 | Returns a rate and its source, even with Wise unreachable | |
| 1.2 | Private inputs: save and load endpoints | P0 | 0.8 | A user can only ever read their own inputs | |
| 1.3 | Private inputs screen (three budgets, dates, preferences, dietary) | P0 | 0.7 | Form saves and reloads | |
| 1.4 | Date-overlap logic with unit tests | P0 | — | Tests pass, including no-overlap | |
| 1.5 | Ceiling + stretch-consent logic with unit tests, including GBP/NGN/EUR | P0 | 1.1 | Tests pass | |
| 1.6 | Feasibility logic with unit tests | P0 | 1.4, 1.5 | Tests pass for fits, doesn't fit, and flight-only failure | |
| 1.7 | Shortlist endpoint | P0 | 1.2, 1.6 | Lowering Maya's budget changes the shortlist; Daniel's response gives no hint why | |
| 1.8 | Private prompts: stretch consent and no-match suggestions, sent to everyone at once | P0 | 1.7 | Every member gets a prompt at the same time | |
| 1.9 | Shortlist screen with labels, cost per person and reasons | P0 | 0.7 | Shows 3–5 options or the neutral no-match message | |
| 1.10 | Prompts screen (or banner) | P0 | 0.7 | User can answer the stretch prompt | |
| 1.11 | Anonymous voting: endpoint + screen; create the trip when voting closes | P0 | 1.7 | Totals update, no names; winner saved as the trip | |
| 1.12 | Stay shortlist and vote for the chosen destination | P1 | 1.11 | Group picks a stay from options that fit | |
| 1.13 | Gemini reasons for each shortlist option (tags only, no budgets) | P1 | 1.7 | Reasons appear; generic text if Gemini fails | |
| 1.14 | Two-person group warning before entering budgets | P2 | 1.3 | Warning shown and must be accepted | |

### Epic 2: Budget plan

| ID | Item | P | Depends on | Done when | Who |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Budget-plan logic with unit tests | P0 | 1.11 | Tests pass | |
| 2.2 | Plan endpoint: group view + caller's own private view | P0 | 2.1 | Each user gets only their own private block | |
| 2.3 | Opt in / out of optional activities; plan recalculates | P0 | 2.2 | Skipping updates only that person's breakdown | |
| 2.4 | Plan screen: group view, private view, join/skip buttons | P0 | 0.7 | Works with mocks, then real API | |
| 2.5 | Gemini itinerary draft (core + optional, dietary-aware) | P2 | 2.2 | Itinerary appears on the plan screen | |

### Epic 3: Expenses and settlement

| ID | Item | P | Depends on | Done when | Who |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Make `expenses` a Tiger Data hypertable | P0 | 0.6 | Inserts and queries work | |
| 3.2 | Save expense endpoint: shared / extra / personal, with rate, source and time | P0 | 3.1, 1.1 | Extras split only among people who joined | |
| 3.3 | Add-expense screen with participant picker and confirm step | P0 | 0.7 | Nothing is saved until confirmed | |
| 3.4 | Gemini receipt parsing → draft expense | P0 | 3.3 | A real receipt photo gives amount, currency and category | |
| 3.5 | Pacing logic, endpoint and message | P0 | 3.2 | Correct message for under and over pace | |
| 3.6 | Simulate-next-day: nudges + banner with pacing | P0 | 3.5 | Button shows each user their own nudge | |
| 3.7 | Settlement logic with unit tests | P0 | 3.2 | Hand-checked 3-currency example matches | |
| 3.8 | Settlement endpoint and screen with rates, sources and "Pay with Wise" link | P0 | 3.7 | Each person sees what they owe in their own currency | |
| 3.9 | Expense list (group shared + your personal) | P1 | 3.2 | Others' personal expenses never appear | |

### Epic 4: Side challenges

| ID | Item | P | Depends on | Done when | Who |
| --- | --- | --- | --- | --- | --- |
| 4.1 | ElevenLabs speech-to-text → Gemini → draft expense | P1 | 3.3 | Spoken sentence becomes a confirmable expense | |
| 4.2 | Tiger Data continuous aggregate of daily spend | P1 | 3.1 | Pacing and "typical daily spend" read from it | |
| 4.3 | Spending-over-time chart | P1 | 4.2 | Chart shows daily group spend | |
| 4.4 | Agent tools: `findStays` and `checkFits` | P1 | 1.12 or seeded stays | `checkFits` returns only fits / doesn't fit | |
| 4.5 | Agent: stay-cancelled scenario with explanation and user confirmation | P1 | 4.4 | Marking the stay unavailable gives a replacement and reason | |
| 4.6 | ElevenLabs reads the evening nudge aloud | P2 | 4.1 | Nudge plays as audio | |

### Epic 5: Quality and submission

| ID | Item | P | Depends on | Done when | Who |
| --- | --- | --- | --- | --- | --- |
| 5.1 | Privacy test: log in as each user and check every response against the contract's "never returns" lists | P0 | Epics 1–3 | No leaks found | |
| 5.2 | Demo reset script / endpoint | P0 | 0.6 | Restores the seed in seconds | |
| 5.3 | Full demo run on the deployed app, twice in a row | P0 | 5.2 | No errors | |
| 5.4 | README: setup, architecture, AI disclosure | P0 | — | Repo public, no secrets | |
| 5.5 | Record the 2-minute video | P0 | 5.3 | Uploaded | |
| 5.6 | Remaining Devpost fields: how we built it, challenges, accomplishments, what we learned | P0 | — | All filled | |
| 5.7 | Rehearse the 3-minute demo three times and Q&A once | P0 | 5.3 | Under 3 minutes every time | |

---

## D. Making the side challenges achievable

Each integration goes into a feature we need anyway. We're not adding features just to qualify for prizes.

| Integration | What we actually implement | How we demo it |
| --- | --- | --- |
| Gemini | Receipt extraction, option reasons, itinerary | Scan a receipt, show the parsed expense |
| ElevenLabs | Voice input for expenses | Speak a sentence, confirm the structured result |
| Tiger Data | Expense hypertable and daily-spend aggregate | Show the spending chart and pacing |
| incident.io | An agent that re-plans when a stay is cancelled | Mark the stay unavailable, show the replacement |
| Vultr | Hosting for the real application | Open the deployed app and complete the main flow |
| GoDaddy Registry | A suitable project domain | Show the deployed app under the chosen domain |

> Each challenge has its own rules, so let's check them before putting time into an integration.

---

## AI disclosure (draft, 10% of the Wise score)

| Part | AI involved | What the team did |
| --- | --- | --- |
| Product idea and problem | None | Original team idea from brainstorming, refined with input from people at Wise |
| Planning docs and Devpost wording | Claude helped structure and edit | Team wrote the drafts and decided scope, features and rules |
| Matching, pacing and settlement code | _Fill in coding assistants used, if any_ | Team designed and wrote the logic |
| Frontend and backend code | _Fill in tools (e.g. Copilot, Claude) and which files_ | Team reviewed, tested and integrated |
| Receipt reading, voice parsing, itineraries, adaptive agent | Gemini and ElevenLabs, at runtime | Team wrote the prompts, tools and guardrails |
| Demo dataset | _Fill in: script or AI-generated_ | Team defined the schema and checked values |

Let's keep a running note of which files or features had AI help as we go, so this table is accurate when we submit.