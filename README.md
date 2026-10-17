# iku-hackathon
This is a repo that contains the IKU Womxn in STEM Hackathon code

This project uses React for frontend and Node.js for backend. both need to be installed to run it.

# Group Trip Planner — Product Description (Draft)

Oct 17, 2026 · @Eva,Josie

## Summary

**A group trip planner where nobody has to say their budget out loud.** Each person enters their budget privately, and only the server can read it. The app finds dates, destinations and stays that fit everyone, and the group votes anonymously.

On the trip, every day has a shared core plan plus optional extras, so friends with different budgets can do different things without awkwardness. Expenses are logged in any currency by receipt photo or voice, each person sees their own private spending pace, and the trip settles up in everyone's home currency through Wise.

Name: to be decided. Pitch line: *transparent costs, private budgets.*

## Problem

Group trips stall on one awkward question: "What's everyone's budget?" People from different financial backgrounds, especially newer friends, don't want to answer it. They overspend, stay quiet, or drop out.

The problem gets worse when friends live in different countries. Flights cost different amounts for each person, everyone thinks in a different currency, and the shared costs end up scattered across chat messages and forgotten receipts.

**Who it's for:** friend groups of 3 to 10 people, often international students or young professionals, planning a trip where at least some members don't know each other's finances.

## What makes it different

Other planners split costs after the fact. This one is designed around what people don't want to say.

- **Private budgets.** Budgets are stored where only the server can read them. The group sees only outcomes labelled "fits everyone", never a number that hints at anyone's limit.
- **Two-track days.** Every itinerary day has a core plan everyone can afford, plus optional extras people join privately. Skipping an extra looks the same as not being interested, and the app offers a cheap parallel option for the same time slot.
- **Private-first resolution.** When nothing fits, each person is asked privately first, at the same moment, so being asked reveals nothing. The group only hears about it if nobody adjusts.
- **Anonymous treats (stretch goal).** Anyone can quietly cover part of an extra for the whole group, like buying a round. The group sees "a friend chipped in", never who.
- **Trip Wrapped.** At the end, the group gets a shareable recap: days, distance, top shared moments, total spent as a group. It never shows any individual's budget.
- **Built for cross-border groups.** Each person uses their own currency, departure airport and nationality from the start, and everything settles in their home currency through Wise.

## Budgets, dates and feasibility

Each member privately enters three budgets in their home currency, their available dates and their trip style. The server turns these into a shortlist that fits everyone.

| Bucket | Who sees it | Covers |
| --- | --- | --- |
| Flights | Owner only | Their own flight to the destination |
| Group budget | Private input, shared outcome only | Accommodation and core shared activities |
| Private budget | Owner only | Daily food, optional extras, personal spending |

**Ceiling.** The group ceiling is computed server-side and never sent to any client:

```latex
\text{ceiling} = \text{lowest} + \min(0.1 \cdot (\text{highest} - \text{lowest}),\ 0.1 \cdot \text{lowest})
```

Anyone whose group budget is below the ceiling is privately asked whether they accept options slightly above their number. If they decline, the ceiling drops to their budget.

**Dates.** Each member marks the date ranges they're free and their minimum and maximum trip length. The server finds overlapping windows that meet the minimum length and searches only those, capped at three windows to limit API calls.

**Flights.** A destination only counts as a fit if every member's estimated flight for that window is within their own flight budget. This handles friends flying from different cities without touching the group budget.

**Group size.**

- 3 or more members: full privacy mode.
- 2 members: all features work, but both people see a clear warning first: "In a group of two, your friend can roughly work out your budget from the options shown." They must tap to accept before entering budgets.

## When nothing fits

The app resolves conflicts privately first and only involves the group as a last step. Everyone gets a private message at the same moment, so receiving one tells you nothing about whether you're the limit.

1. **Private round (24 hours).** Every member gets a personal prompt with options suited to them:
   - Members whose budget, flight budget or dates are limiting: "The closest options start around €X per person. Could you raise your number, or open up more dates?"
   - Everyone else: "Would you be open to a shorter trip, a cheaper region or off-peak dates?"
2. **Recompute.** As soon as anyone updates their budget, dates or preferences, the server reruns feasibility. If options now fit, the group gets the shortlist as normal.
3. **Group round.** If nothing fits after 24 hours, the whole group sees a neutral message: "No trip fits everyone yet." It comes with suggestions such as fewer nights, a closer region or different dates. It never says whose budget or availability is limiting.
4. **Repeat.** Members update privately, and the app recomputes again.

The same flow applies when no stays fit the chosen destination, or when there's no date window everyone shares.

## User journey

The journey runs in three phases: plan, travel and settle.

**Before the trip**

1. **Create and join.** The organiser creates the group. Members join with their home currency, nationality and departure airport.
2. **Enter your private budget.** Each member privately enters their three budgets, available dates, trip style (beach, culture, hiking, nightlife) and dietary needs.
3. **Shortlist.** The server returns 3 to 5 destinations labelled "fits everyone", each with an estimated cost per person and a short explanation of how it matches the group's tastes. Estimates come from sample data on what past groups spent there.
4. **Anonymous vote.** Members approve or reject each option. Only the totals are shown, never who voted for what.
5. **Flights.** Each member sees flight options from their own airport, with a link to Google Flights.
6. **Stay.** The server searches stays, keeps only those safely under the ceiling, ranks them by rating (not price), and shows 3 to 5 options in different areas. The group votes anonymously, and the winner gets prefilled Booking.com and Airbnb links.
7. **Two-track itinerary.** Gemini drafts each day around the stay's location: a core plan inside the group budget, plus optional extras with a per-person price. Members privately tap "I'm in" or "Pass" on extras. The group sees who's going, but never why someone passed, and anyone not joining gets a cheap or free alternative for that time slot.
8. **Entry requirements.** Each member gets a link to the official entry-requirements page for their nationality.

**During the trip**

9. **Log expenses.** Snap a receipt and Gemini reads the amount, currency and category. The payer marks it as shared (split among participants), extra (split only among people who opted in) or personal (visible only to them). The exchange rate at that moment is saved with it.
10. **Evening nudge.** Each evening: "Did you pay for anything today?" with a one-tap quick add. Any member can tap "something's missing" to prompt the payer.
11. **Private pacing.** Each member sees a line only they can see, for example "You're €18 under your daily pace." Pacing is computed from their private budget and spending so far.

**After the trip**

12. **Settle up.** The app works out who owes whom with the fewest payments, converts each amount to the payer's home currency at the saved rates, and links to pay with Wise.
13. **Trip Wrapped.** The group gets a shareable recap of the trip, with group totals only.

## Privacy rules

No member's budget, ceiling or limiting constraint ever leaves the server.

- Budgets are stored with row-level security, so a user can only read their own row.
- The ceiling is computed in one server function and never returned to any client.
- Shortlists show a spread of options well under the ceiling. They're never sorted by price from highest to lowest and never labelled "at the limit".
- Private-first prompts go to every member at the same moment, so receiving one reveals nothing.
- Passing on an extra shows no reason. Votes show totals only.
- Gemini receives filtered shortlists and preference tags only, never any budget.
- Trip Wrapped and group views show group totals only.
- When a member leaves, their private data is deleted and the ceiling is recomputed.
- Known limit: in a two-person group, budgets can be roughly inferred. Both members are warned before they start.

## Data, integrations and AI

All budget maths is deterministic server code. AI is used only for reading receipts and writing text, and never sees a budget.

| Component | Source | Type |
| --- | --- | --- |
| Feasibility, ceiling, date overlap, pacing, settlement | Own server code | Deterministic |
| Expenses, daily spend, past-group sample data | Tiger Data (PostgreSQL) | Database, time-series |
| Flights, hotels, rentals | SerpApi | External search, scraping-based (licensed APIs in production) |
| Restaurants and attractions | Google Places | External |
| Weather for re-planning | Weather API (e.g. Open-Meteo) | External |
| Exchange rates | Wise API | External, with a labelled fallback |
| Receipt reading, spoken-expense parsing, explanations, itineraries | Gemini API | AI, receives no budget data |
| Re-planning agent | Gemini with our own tools | AI, sees only "fits" / "doesn't fit" |
| Voice input and spoken check-ins | ElevenLabs speech-to-text and text-to-speech | AI, receives no budget data |
| Booking links, Wise payment links | Own code | Deterministic |
| Hosting | Vultr | Cloud |

**Sample data.** Past-group spending is seeded dummy data stored in Tiger Data. It's labelled "sample data" in the demo and pitched as real history in production. Continuous aggregates turn it into figures like "groups of 4 spent about €65 per person per day in Lisbon".

## Tracks and side challenges

We enter the Wise track as our one main track, plus every side challenge the product can win without a detour. Each side challenge must appear naturally inside the 3-minute demo, not as a bolt-on. [Event page](https://iku-womxn-in-stem-hackathon.devpost.com/)

| Challenge | Prize | How the product qualifies | Extra effort | Priority |
| --- | --- | --- | --- | --- |
| Wise: Max Ease (main track) | Merch, trophy, fast-track intern/grad interview (1st–3rd) | The whole product | — | Must |
| incident.io: Adaptable Agents | Lego sets | A planning agent that re-plans when circumstances change (see below) | Medium | High |
| ElevenLabs: Best Project Built with ElevenLabs | 3 months Scale tier per member | Voice expense logging in any language, and spoken evening check-ins in each member's language | Medium | High |
| MLH: Best Use of Gemini API | MLH swag kits | Receipt reading, parsing spoken expenses, itineraries, the agent's reasoning | Low | High |
| MLH: Best Use of Tiger Data | Stream Deck Mini | Expenses as time-series, pacing from continuous aggregates, past-group averages | Low | High |
| MLH: Best Use of Vultr | M5Stack Tab5 | Host the app on Vultr | Low | Medium |
| MLH: Best Domain Name (GoDaddy Registry) | Digital gift card | Register a domain once we pick a name | Very low | Medium |
| Best Beginner Hack | Label printers | Only if most of the team comes from a non-CS-adjacent background | None | Check eligibility |
| DEV Writing Challenge (MLH page) | $100 | Write up the build on DEV after the event | Low, after event | Later |

**Skipped:** the Society track (only one main track allowed), Hackiest Hack (it rewards over-engineering, which works against Wise's 30% on execution), and Solana, Presage and Snowflake (forced fits).

**The adaptive agent (incident.io).** A Gemini agent with tools for flights, stays, weather and a feasibility check. It never sees a budget: the feasibility tool only answers "fits everyone" or "doesn't". It reacts to new evidence and explains what it changed and why:

- A member updates their budget or dates → it reruns the shortlist and runs the private-first flow if nothing fits.
- A flight price jumps or a stay sells out → it swaps in the next option that fits everyone.
- Rain is forecast for a beach day → it moves that day's core plan indoors and keeps the extras.
- A member drops out → it recomputes the ceiling and the expense splits.

**Voice (ElevenLabs).** A member says "I paid 42 euros for dinner for all four of us" in any language. ElevenLabs speech-to-text transcribes it, Gemini turns it into a shared expense, and the member confirms with one tap. The evening check-in can also be spoken aloud in each member's language, which supports Wise's "inclusive accessibility" direction.

## Scope

The demo has to show the sealed-envelope moment working end to end. Everything else is supporting material.

**Must build (the demo)**

- Private budgets, date overlap, ceiling and private stretch consent
- Destination shortlist from sample data, with anonymous voting
- Private-first resolution when nothing fits
- Receipt scanning and voice logging, shared/extra/personal expenses, multi-currency with live Wise rates
- Evening nudge with a "simulate next day" button, plus private pacing
- Settle-up in home currencies with Wise links

**Should build (if time allows, in this order)**

1. Re-planning agent for the incident.io challenge (one scenario working well beats four half-working)
2. Two-track itinerary with optional extras (Gemini)
3. Stay search and voting (SerpApi), with Booking.com and Airbnb links
4. Live flight estimates, then Trip Wrapped

**Simplified**

- Entry requirements: links to official pages only
- Restaurants: only inside the itinerary, filtered by diet, not a separate feature

**Roadmap (pitch only)**

- Anonymous treats
- Direct booking through partner APIs
- Real past-group history replacing sample data
- In-app payments

**Cut**

- Flight cost pooling: rare among friends, and it adds pressure the app is meant to remove
- Built-in visa rules: no reliable free source, and wrong answers are risky
- A standalone "hidden gems" or food feature: too similar to other planners

## Success criteria and judging fit

**Success criteria**

- A group goes from "no plan" to an agreed destination, dates and stay without anyone stating a budget.
- The evening nudge gets an expense logged in under 20 seconds.
- Settlement needs no spreadsheet and no manual currency conversion.
- No member's budget can be read or inferred from anything shown, in groups of 3 or more.

**Wise rubric.** Each category is scored 1 to 4. Final score = 0.3 × Friction + 0.3 × Technical + 0.3 × Presentation + 0.1 × AI transparency. Presentation counts as much as the code, so rehearse the demo as seriously as you build.

| Category (weight) | What a 4 needs | How we get there |
| --- | --- | --- |
| Friction removal and utility (30%) | Removes complex friction entirely; feels effortless and accessible to all | No budget conversation, no scheduling back-and-forth, one-tap or spoken expense logging, no manual currency maths, voice in any language |
| Technical and architectural execution (30%) | Production-ready, high performance, elegant error handling, robust tech choices | Live Wise, Gemini and ElevenLabs calls; deterministic budget maths on the server; row-level security; every fallback labelled with source and time |
| Presentation and pitching (30%) | Compelling pitch, flawless live demo, strong Q&A | Live demo of the main journey, not slides; rehearsed to fit 3 minutes; Q&A answers prepared below |
| AI usage and transparency (10%) | Explicitly states where AI was used versus original work | A full disclosure table on a slide and in the README (see AI disclosure) |

**Avoid the score-2 trap.** The rubric marks down demos that "rely on heavy hardcoded shortcuts". Keep seeded past-group data in the real database behind real queries, label it as sample data, and use cached flight prices only as a labelled fallback when the live call fails.

**Demo script (3 minutes).** Use three users in London, Lagos and Madrid with very different budgets. Show that each person sees only their own budget, then reveal the shortlist that fits all three. Pass on an extra to show the two-track day, scan a receipt, then settle in GBP, NGN and EUR.

## Q&A to prepare

| Question | Answer |
| --- | --- |
| Why not book inside the app? | Booking.com's API needs a partner agreement and Airbnb has no public booking API. We hand off to their sites and keep direct booking on the roadmap. |
| Can people infer each other's budgets? | Not from anything displayed in groups of 3 or more. In groups of 2 it's possible, and we warn both people up front. |
| Doesn't the lowest budget control the trip? | It controls only the shared core. Extras let others spend more without pressure, and stretch consent lets the lowest budget choose to go slightly higher. |
| What if a provider goes down? | The app falls back to cached data or deep links and always labels the source and time. |
| Where does the past-trip data come from? | It's seeded sample data for the demo, labelled as such. In production it would come from real anonymised trips. |
| Does the AI see budgets? | No. Gemini receives only filtered options and preference tags. |
| How would Wise make money? | Group trips create repeated cross-border settlements, and the app could live inside the Wise app as a group feature. |

## AI disclosure

This table goes on a pitch slide and in the README. A 4 needs every AI-assisted part named and separated from the team's own work.

| Part | AI involved | What the team did |
| --- | --- | --- |
| Product idea, problem and budget logic | None | Original team idea |
| Planning and this product description | Claude helped structure and draft | Team decided scope, features and rules |
| Feasibility, ceiling, pacing, settlement code | List coding assistants used, if any | Team designed and wrote the logic |
| Frontend and backend code | List tools used (e.g. Copilot, Claude) and which files | Team reviewed, tested and integrated |
| Receipt reading, voice parsing, itineraries, re-planning agent | Gemini API, at runtime | Team wrote the prompts, tools and guardrails |
| Speech-to-text and spoken check-ins | ElevenLabs, at runtime | Team built the flow and confirmation step |
| Sample past-group data | Fill in: generated by script or AI | Team defined the schema and checked values |

Keep a running note during the event of which files or features had AI help, so the table is accurate at the end.

## Submission checklist

Draft deadline: Saturday 17 October, 23:00, with the main track and side challenges selected. Final deadline: Sunday 18 October, 12:15 BST. [Event page](https://iku-womxn-in-stem-hackathon.devpost.com/)

- [ ] Devpost draft started tonight, with Wise as the main track and all side challenges ticked
- [ ] Name, description, how it was built, challenges, accomplishments, what's next
- [ ] 2-minute demo video
- [ ] Public GitHub repo with only code built during the event
- [ ] All team members listed with valid emails
- [ ] Domain registered with GoDaddy Registry
- [ ] App deployed on Vultr
- [ ] AI disclosure slide and README section
- [ ] 3-minute live demo rehearsed, plus 2 minutes of Q&A