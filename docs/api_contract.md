# Budget Group Trip Planner – API Contract

## Why we're writing this first

This is our agreement on what every endpoint takes in and sends back. We're writing it before building the endpoints so that:

- **Nobody's blocked.** Whoever's on screens copies the example responses into mock files and builds straight away. Whoever's on endpoints builds them to return the same shape. When an endpoint's ready, we switch that screen over and it just works.
- **We agree on names once.** Field names, units and currencies are decided here, not guessed separately on each side.
- **It's our privacy checklist.** Every endpoint lists what it must never return, and that's what we test against before the demo.

## How we're using it

1. We go through the demo screens and list the data each one needs. Each need becomes an endpoint.
2. For each endpoint we write the method and path, an example request, an example response, and what it must never return, in the same format as the examples below.
3. We read it through together and agree. If anything changes later, we change it here first.
4. Frontend: each example response goes in `frontend/src/mocks/<name>.json`. `frontend/src/api.js` returns the mock while `USE_MOCKS` is on, and calls the real endpoint when it's off.
5. Backend: each endpoint returns exactly the example's shape. Quickest check is to call it and compare.
6. We switch mocks off one endpoint at a time as they're finished.

## Conventions

- All requests except `/auth/join` send `Authorization: Bearer <token>`.
- Money is always an object: `{ "amount_minor": 12350, "currency": "GBP" }` means £123.50.
- Dates are `YYYY-MM-DD`. Timestamps are ISO 8601 in UTC.
- Errors: `{ "error": { "code": "not_member", "message": "You're not in this group." } }`. Messages never name another person or include a number from their budget.
- "Me" endpoints (`/me/...`) only ever return the caller's own data.

---

## Worked examples

### `POST /auth/join`

Join a group with an invite code.

**Request**
```json
{ "invite_code": "LISBON24", "name": "Maya", "home_currency": "GBP", "home_airport": "LHR", "nationality": "GB" }
```

**Response 200**
```json
{
  "token": "eyJhbGciOi...",
  "user": { "id": "u_maya", "name": "Maya", "home_currency": "GBP" },
  "group": { "id": "g_1", "name": "Summer trip", "status": "planning", "member_count": 3 }
}
```

**Never returns:** other members' inputs.

---

### `PUT /groups/:groupId/me/inputs`

Save the caller's private inputs. Called by the private budget form.

**Request**
```json
{
  "currency": "GBP",
  "flight_budget": { "amount_minor": 20000, "currency": "GBP" },
  "group_budget": { "amount_minor": 30000, "currency": "GBP" },
  "personal_budget": { "amount_minor": 15000, "currency": "GBP" },
  "availability": [{ "start": "2026-11-06", "end": "2026-11-15", "min_nights": 3, "max_nights": 5 }],
  "preferences": { "tags": ["beach", "culture"], "dietary": ["vegetarian"] }
}
```

**Response 200:** the same object back, as saved.

**Never returns:** anything about other members, or whether this change affected the shortlist.

---

### `GET /groups/:groupId/shortlist`

The options that fit everyone.

**Response 200 (options found)**
```json
{
  "status": "options",
  "options": [
    {
      "destination_id": "d_lisbon",
      "city": "Lisbon",
      "dates": { "start": "2026-11-07", "end": "2026-11-10", "nights": 3 },
      "shared_cost_per_person": { "amount_minor": 21000, "currency": "EUR" },
      "label": "Fits everyone",
      "reason": "Beaches and old-town culture, lots of vegetarian food.",
      "typical_daily_spend": { "amount_minor": 6500, "currency": "EUR", "is_sample": true },
      "votes": { "approve": 1, "reject": 0 }
    }
  ]
}
```

**Response 200 (nothing fits)**
```json
{ "status": "no_match", "message": "No trip fits everyone yet. Check your private prompts for ways to help." }
```

**Never returns:** the ceiling, any member's budget, which member is limiting, or options sorted by price descending.

---

### `GET /groups/:groupId/plan`

The budget plan after the vote. The same endpoint returns a different `private` block depending on who calls it.

**Response 200**
```json
{
  "trip": { "city": "Lisbon", "start": "2026-11-07", "end": "2026-11-10", "stay": "Casa Alfama" },
  "group": {
    "shared_cost_per_person": { "amount_minor": 21000, "currency": "EUR" },
    "core_activities": [{ "id": "ta_1", "name": "Old town walking tour", "price": { "amount_minor": 0, "currency": "EUR" } }],
    "optional_activities": [{ "id": "ta_2", "name": "Sunset sailing", "price": { "amount_minor": 4500, "currency": "EUR" }, "joined_count": 2 }]
  },
  "private": {
    "currency": "GBP",
    "committed_shared": { "amount_minor": 17900, "currency": "GBP" },
    "food_estimate": { "amount_minor": 9000, "currency": "GBP" },
    "extras_joined": { "amount_minor": 0, "currency": "GBP" },
    "left": { "amount_minor": 6000, "currency": "GBP" },
    "my_optins": { "ta_2": false }
  }
}
```

**Never returns:** another member's `private` block, or the reason anyone skipped an activity.

---

## Still to write up in this format

| Endpoint | Purpose | Must never return |
| --- | --- | --- |
| `GET /groups/:id` | Group name, member names, status | Anyone's budget |
| `GET /groups/:id/me/inputs` | Load the caller's saved inputs | Others' inputs |
| `GET /groups/:id/me/prompts` | Private prompts (stretch consent, no-match suggestions) | Who is limiting |
| `POST /groups/:id/me/stretch` | Answer the stretch prompt | — |
| `POST /groups/:id/votes` | Vote on a destination, stay or activity | Who voted for what |
| `PUT /trip-activities/:id/optin` | Join or skip an optional activity | Reasons |
| `POST /expenses/parse-receipt` | Image → draft expense (not saved) | — |
| `POST /expenses/parse-voice` | Audio → transcript + draft expense (not saved) | — |
| `POST /groups/:id/expenses` | Save a confirmed expense | — |
| `GET /groups/:id/expenses` | Expenses the caller can see | Others' personal expenses |
| `GET /groups/:id/me/pacing` | The caller's pacing message | Others' pacing |
| `GET /groups/:id/spending-daily` | Daily group spend from the Tiger aggregate | Per-person totals |
| `POST /groups/:id/simulate-next-day` | Demo only: trigger nudges | — |
| `GET /groups/:id/settlement` | Who pays whom, in each payer's currency, with rates | — |
| `POST /groups/:id/agent/replan` | Agent proposes a replacement stay and explains | Budgets, ceiling |
| `POST /admin/reset` | Demo only: restore seed data | — |