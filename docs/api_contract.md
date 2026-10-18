# Budget Group Trip Planner – API Contract

What every endpoint takes and returns, as built (updated 18 Oct 2026). Every endpoint lists what it must never return: that's our privacy checklist.

## Conventions

- Base path is `/api`. The React dev server proxies to the backend on port 8080.
- Every request except `/signup` and `/login` sends `Authorization: Bearer <token>`. The token is a JWT holding `{ userId }`, valid for 7 days.
- Money is stored and sent as integers in minor units (pence, cents, kobo), with a currency code, e.g. `amount_minor: 12350, currency: "GBP"` is £123.50.
- Dates are `YYYY-MM-DD`.
- Errors are `{ "error": "message" }` with a 4xx status. A malformed id returns 400 `invalid id`. Error messages never name another person or include anyone's budget.
- A trip is a row in `groups`. `:groupId` is its UUID. Trip status moves `planning → voting` (or `resolving`) `→ booked → on_trip → settled`.

## Accounts and friends

| Method and path | Body / query | Returns | Never returns |
| --- | --- | --- | --- |
| `POST /signup` | `username` (3–20, a–z 0–9 _), `password` (8+), `name`, `homeCurrency`, `departureAirport` | `{ token }` | — |
| `POST /login` | `username`, `password` | `{ token }`. A wrong username takes as long as a wrong password. | Whether a username exists |
| `GET /account` | — | The caller's profile and every trip they're in, with their **own** budget and dates, the shortlist with vote totals and their own vote, their own flight price per option, and "past groups spent about X a day" | Anyone else's budget, dates, flights or votes |
| `GET /friends` | — | Friends and pending requests, public profile fields only | — |
| `POST /friends/requests` | `username` | `{ status }`. If they'd already asked you, this accepts it. | — |
| `POST /friends/requests/:userId/accept` | — | `{ status: "accepted" }` | — |
| `DELETE /friends/:userId` | — | Declines, cancels or removes | — |
| `GET /notifications` | — | Latest notifications and the unread count | Other people's personal expenses |
| `POST /notifications/read` | — | `{ ok: true }` | — |

## Planning

| Method and path | Body / query | Returns | Never returns |
| --- | --- | --- | --- |
| `POST /trips` | `name`, `friendIds` (accepted friends only) | `{ id }`. The creator is the organiser. | — |
| `PUT /budgets/:groupId` | `flight_minor`, `group_minor`, `private_daily_minor` (home currency), optional `free_from`, `free_to` | The caller's saved budget. Recomputes the shortlist for the group. | Whether this change affected the shortlist |
| `DELETE /trips/:groupId/membership` | — | 204. Deletes the caller's budget, dates and votes, hands over organising if needed, and recomputes the shortlist. | — |
| `PUT /trips/:groupId/options/:optionId/vote` | `approve`: `true`, `false` or `null` | `{ ok: true }` | Who voted for what |
| `POST /trips/:groupId/options/:optionId/book` | — (organiser) | `{ status: "booked" }` | — |
| `POST /trips/:groupId/start` | — (organiser) | `{ status: "on_trip" }` | — |
| `GET /insights?currency=GBP` | — | Average spend per person per day by city and by month, and the split between categories. Anonymised or sample data only. | Any individual trip or person |
| `GET /rates?currencies=GBP,NGN` | — | `{ rates, source, fetched_at }`, per 1 EUR. `source` is `wise` or `fallback`. | — |

The shortlist itself is computed in `shortlist.js` whenever a budget or the membership changes, and read through `GET /account`. The ceiling and the diagnostics on who is limiting never leave that function.

## On the trip

All under `/trips/:groupId`, for members only.

| Method and path | Body | Returns | Never returns |
| --- | --- | --- | --- |
| `GET /` | — | Trip, members, expenses the caller can see, balances, suggested or frozen settlements, the caller's private `pace`, recent activity, and the rate source | Other people's personal expenses or pace |
| `POST /parse-receipt` | `image_base64`, `mime_type` (jpeg, png, webp, heic) | `{ draft, source: "gemini" }` or `{ draft: null, source: "manual" }`. A draft has `amount`, `category`, `merchant`, `date` and `items`. **Saves nothing.** | — |
| `POST /parse-voice` | `audio_base64`, `mime_type` (webm, mp4, mpeg, ogg, wav, m4a, aac) | `{ transcript, draft, source }`. Items carry `participant_ids`. **Saves nothing.** | — |
| `POST /expenses` | `type` (`shared`, `extra`, `personal`), `category`, `description`, `amount_minor`, `currency`, and either `participant_ids` or `items: [{ amount_minor, participant_ids }]` | The saved expense, with a `confirmation` sentence such as "Saved €42 for Dinner. Amara owes you €12." | — |
| `POST /speak` | `text` (up to 300 characters) | `audio/mpeg` from ElevenLabs, or 503 | — |
| `DELETE /expenses/:expenseId` | — (the payer, until the trip is settled) | 204 | — |
| `POST /next-day` | — (organiser, demo clock) | `{ current_day }` | — |
| `POST /settle` | — (organiser) | `{ payments }`. Freezes the payments and marks the trip settled. | — |
| `POST /settlements/:settlementId/paid` | — (the payer) | `{ ok: true }` | — |

**Splitting with items.** When `items` are sent, the total is split in proportion to each person's items, and an item shared by several people is split evenly between them (`weightsFromItems` and `splitByWeights` in `logic/expenses.js`). The items don't need to add up to the total exactly: tax and tip are shared in the same proportions.

## Not built

These were in our first plan and aren't endpoints yet: private prompts and stretch consent (`/me/prompts`, `/me/stretch`), opting in to optional activities, the budget-plan view, the re-planning agent and `/admin/reset` (use `npm run db:reset` instead).
