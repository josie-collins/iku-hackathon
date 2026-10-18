# Budget Group Trip Planner – Internal Team Doc

Our working plan for the build, demo and pitch. This one stays internal, not on Devpost.

Related files:
- `system_design.md`: how the app works (architecture, database, logic, privacy)
- `api_contract.md`: exact request and response formats for every endpoint

## Status at 03:00 Sunday

**Built, OK to demo:** accounts and friends; trips; private budgets and dates; hidden ceiling; date overlap; "fits everyone" shortlist with live SerpApi flight prices; "past groups spent about €X a day" (Snowflake, Postgres fallback); anonymous voting and booking; neutral no-match message; two-person warning; receipt scanning with Gemini and per-item split; voice entry (ElevenLabs → Gemini) with spoken confirmation; shared/extra/personal expenses at Wise rates with a labelled fallback; private pace; simulate next day; notifications; settle-up in home currencies with Wise links; Insights tab and Snowflake Streamlit dashboard.

**Not built, "What's next" only:** re-planning agent (incident.io), stretch-consent screen and private-first prompts, two-track days and budget-plan view, itinerary, stay search, Trip Wrapped, Vultr hosting and domain.

**Known issues:** 3 of 75 unit tests fail (`tests/wise.test.js`: the Wise-success and cache cases); the fallback cases pass. Cortex reasons fall back to templates on the Snowflake trial.

**Demo users** are now Tom (London, GBP), Amara (Lagos, NGN) and Lucia (Madrid, EUR), not Maya, Daniel and Sofia.

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

The pitch is **live demo first, slides second**. The judges score "flawless live demo" under Presentation (30%), so slides only frame the story: about 30 seconds of slides, then the app.

**Setup before going on stage**
- Run `npm run db:reset`. The "Summer Trip" group (Tom, Amara, Lucia) then has a shortlist to vote on, and "Porto Weekend" (Lucia organises, with Tom and Amara) is a trip in progress for logging expenses and settling up.
- Open three browser profiles (or one normal and two private windows), logged in as `tom`, `amara` and `lucia` (password `demo1234`), side by side.
- Have a printed receipt ready (`receipt1.jpeg` or a real one), test the microphone, and turn the volume up for the read-back.
- Keep the recorded video open in another tab as a backup in case the Wi-Fi or an API fails.

**Live demo (3 minutes)**

| Time | Who talks | What's on screen | Say |
| --- | --- | --- | --- |
| 0:00 | Speaker 1 | Slides 1–3 | "What's everyone's budget?" Nobody wants to answer, especially across countries and currencies. Our answer: budgets go in a sealed envelope. |
| 0:30 | Speaker 2 | Tom's window: his budget in GBP. Switch to Amara's: hers in NGN. | Each person sees only their own numbers, in their own currency. |
| 0:55 | Speaker 2 | Summer Trip shortlist: "Fits everyone", past-group spend, each person's own flight price | The server checked every budget and live flight prices. Nobody can see whose budget is the limit. Prague, Budapest, Athens and Split are missing because one person's flight doesn't fit, and nobody can tell whose. |
| 1:25 | Speaker 2 | Tom and Lucia vote, and the totals update | Votes are anonymous: totals only. |
| 1:40 | Speaker 1 | Porto Weekend: scan the receipt, tap who had what, save | Gemini reads every line. The bill splits by what each person actually had. |
| 2:05 | Speaker 1 | Voice: "I paid 30 euros for lunch, Amara had the salad for 12". Confirm. Audio plays. | ElevenLabs hears it, Gemini drafts it, you confirm, and it reads back who owes what. |
| 2:25 | Speaker 1 | Private pace line, then settle-up in GBP, NGN and EUR with "Pay with Wise" | Your pace is visible only to you. Settling up takes the fewest payments, each in the payer's own currency, at Wise rates. |
| 2:45 | Speaker 2 | Slide 9 (AI disclosure) briefly, then slide 10 | AI reads and speaks; it never sees a budget. Next: a re-planning agent. "Transparent costs, private budgets." |

If a provider fails live, say so and show the labelled fallback ("fallback rates", manual entry). That's part of the technical story. Don't hide it.

**2-minute demo video (required on Devpost)**

Record it as a screen recording with a voice-over (QuickTime on a Mac: File → New Screen Recording). Use the same flow as the live demo, minus the slides:

1. 0:00–0:10: title card and the one-line problem.
2. 0:10–0:35: private budgets in two windows, two currencies.
3. 0:35–1:00: the shortlist, flight prices and anonymous voting.
4. 1:00–1:25: receipt scan and per-item split.
5. 1:25–1:45: voice entry with the audio read-back (keep the audio in the recording).
6. 1:45–2:00: pace and settle-up with Wise, then the closing line.

Upload it to YouTube (unlisted is fine) and link it on Devpost. Add the same video to the Canva deck after slide 7 as the backup.

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

## AI disclosure (10% of the Wise score)

The full table now lives in the [README](../README.md#ai-disclosure), and the same content is on the AI disclosure slide. It's written at team level (how we used AI, not who did what). **Josie: before we submit, check it covers any AI tools you used**, for your code or the seed data. If you used any, add a row to the README table and the slide.