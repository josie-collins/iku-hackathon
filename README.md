# Wise Piggy

**Transparent costs, private budgets.** A group trip planner where nobody has to say their budget out loud.

**Try it:** https://wisepiggy.club. Log in as `tom`, `amara` or `lucia` with the password `demo1234`.

We're Eva Stamatovska and Josie Collins, and we built this in 24 hours at the [IKU Womxn in STEM Hackathon](https://iku-womxn-in-stem-hackathon.devpost.com/) (17–18 October 2026).

**Main track:** Wise – Max Ease. 

**Side challenges:** ElevenLabs, MLH Best Use of Gemini API, MLH Best Use of Snowflake API, MLH Best Use of Vultr, MLH Best Domain Name from GoDaddy Registry.

## Why we built it

Every group trip we've planned has hit the same wall: someone asks "so what's everyone's budget?", and the chat goes quiet. Nobody wants to be the one who can't afford the nice place, and nobody wants to look like they're showing off. So people agree to things they can't really afford, or they quietly drop out.

It's worse when your friends live in different countries. Flights cost each person a different amount, everyone thinks in their own currency, and by the end of the trip the receipts are scattered across a group chat and nobody is sure who owes what.

We wanted an app where you can say what you can afford without anyone else ever seeing it.

## What it does

**Before the trip**

- You privately enter three numbers in your own currency: what you can spend on flights, your share of group costs (like the stay), and a daily budget for food and extras. Nobody else in the group ever sees them.
- Everyone marks when they're free, and the app finds the dates that work for all of you.
- The app builds a shortlist of destinations that fit **everyone**. For each person it checks their flight (live Google Flights prices from their own airport), their share of the stay and the daily food cost against their own budget. Behind the scenes it works out a group spending ceiling, and that number never leaves the server.
- Each option shows what past groups spent there per day, so you know what you're getting into.
- The group votes anonymously. You see totals, never who voted for what.
- If nothing fits, everyone sees the same neutral message. It never says whose budget is the problem.
- In a group of two, you could roughly work out the other person's budget, so both of you get a warning before entering one.

**During the trip**

- **Snap a receipt.** Gemini reads the total, currency, shop and every line. You tap who had what, and the bill is split by what each person actually ordered.
- **Or just say it.** "I paid 42 euros for dinner, Amara had the pasta for twelve." ElevenLabs turns your voice into text, Gemini turns that into a draft expense, you check it, and ElevenLabs reads back what was saved: "Saved €42 for Dinner. Amara owes you €12."
- Expenses can be shared, an optional extra, or personal (only you can see those). Any currency works, converted at live Wise rates.
- You get a private line only you can see, like "You're €18 under your daily pace."
- You get a notification when someone adds an expense you're part of.
- **Simulate next day** moves the trip forward, which is handy for demos.

**After the trip**

- The app works out who owes whom with as few payments as possible, converts each one into the payer's home currency, and links to Wise to pay.

**Also:** accounts with passwords, friends and friend requests, and an Insights tab showing what trips cost by city and by month.

## How we keep budgets private

Hiding something in the UI isn't the same as keeping it private, so the rules live on the server:

- Nobody's budget, the group ceiling, or who is holding the group back ever leaves the server. Every response is built from an explicit list of fields.
- Private queries are always filtered by the logged-in user.
- Votes come back as totals. Personal expenses only go to the person who paid.
- **AI never sees a budget.** Gemini only gets receipt photos, transcripts and member names. Snowflake Cortex only gets destination tags, trip styles, nights and month, and we throw away any reply that mentions money. `code/backend/gemini.js` doesn't even import the database.
- Snowflake only holds anonymised data: hashed trip ids, no names, no budgets, no personal spending, and no trips with fewer than 3 people.
- If you leave a trip, your budget and dates are deleted and the shortlist is worked out again for everyone else.

## How it's built

```
Browser (React)
   │  every request carries a login token (JWT)
   ▼
Express API (code/backend) ── also serves the built React app in production
   ├── *.js           routes: trips, budgets, booking, expenses, friends, notifications, insights
   ├── logic/         the maths, as plain tested functions: dates, ceiling, feasibility, currency, splits, pace
   └── integrations/  Wise, SerpApi (flights), ElevenLabs, Snowflake, plus gemini.js
   │
   ├──▶ PostgreSQL    all the app's data
   └──▶ Snowflake     an anonymised copy for analytics, plus a Streamlit dashboard

Live: Vultr Ubuntu server → Caddy (HTTPS) → Node on port 8080, at wisepiggy.club
```

Every outside service has a fallback, so if one is down only that feature gets worse. The rest of the app keeps working.

| Part | What we use | If it's unavailable |
| --- | --- | --- |
| Budget maths: ceiling, feasibility, dates, pace, splits, settle-up | Our own code in `code/backend/logic/`, with 75 unit tests | Nothing to fall back to. It's plain code. |
| Database | PostgreSQL | — |
| Exchange rates | Wise API (sandbox) | Fallback rates, clearly labelled in the app |
| Flight prices | SerpApi (Google Flights), cached for 12 hours | Sample flight prices from the database |
| Reading receipts and voice notes | Gemini (`gemini-3.8-flash`, switching to `gemini-3.5-flash-lite` when it's busy) | You type the expense in by hand |
| Voice in and out | ElevenLabs `scribe_v2` (speech-to-text) and `eleven_v4_turbo` (text-to-speech) | Typed entry, no audio |
| "Past groups spent about €X a day" and Insights | Snowflake, with a Streamlit dashboard in `code/snowflake/` | The same sums done in PostgreSQL |
| "Why this fits" reasons | Snowflake Cortex | A template reason. Cortex isn't on trial accounts, so that's what you'll usually see. |
| Hosting | Vultr VPS, Caddy for HTTPS, systemd to keep it running | — |

`code/backend/db/timescale.sql` is an optional Tiger Data (TimescaleDB) script we wrote but didn't get to use. The app doesn't depend on it.

There's more detail in [docs/system_design.md](docs/system_design.md) (how it works and why) and [docs/api_contract.md](docs/api_contract.md) (every API endpoint).

### What's where

```
code/backend/        Express API, database scripts (db/), maths (logic/), outside services (integrations/), tests
code/frontend/       React app
code/scripts/dev.js  the "npm run dev" script that runs everything locally
code/snowflake/      Streamlit dashboard and Snowflake notes
deploy/              scripts for putting it on a server
docs/                system design, API contract, Devpost text, our build plan
```

## Running it on your laptop

You'll need **Node 20 or newer** (22 is best) and **PostgreSQL**.

### 1. Get PostgreSQL running

On a Mac with Homebrew:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb tripplanner
```

Any PostgreSQL database works. A hosted one is fine too, as long as you have its connection string.

### 2. Install everything and create your `.env`

From the repo root:

```bash
npm run setup
```

This installs the backend and frontend packages. If `code/backend/.env` doesn't exist yet, it copies `code/backend/.env.example` to `.env` and fills in a random `JWT_SECRET` for you.

### 3. Fill in `code/backend/.env`

Open `code/backend/.env`. Only the database line is required. Everything else is optional, and each missing key just switches that feature to its fallback.

| Variable | Needed? | What it's for |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | Your database, e.g. `postgresql://localhost:5432/tripplanner` |
| `JWT_SECRET` | **Yes** (filled in for you) | Signs login tokens. Any long random string. |
| `PORT` | No | Defaults to `8080` |
| `WISE_BASE_URL`, `WISE_API_KEY` | No | Live exchange rates. A sandbox key only works with the sandbox URL. |
| `GEMINI_API_KEY` | No | Receipt scanning and voice parsing. The free tier is enough. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | No | Voice entry and spoken confirmations |
| `SERPAPI_KEY` | No | Live flight prices |
| `SNOWFLAKE_*` | No | Insights and Cortex. Put the private key in `code/backend/keys/` and point `SNOWFLAKE_PRIVATE_KEY_PATH` at it. |
| `ANALYTICS_SALT` | No | Salt for anonymised trip ids sent to Snowflake |

Never commit `.env` or anything in `keys/`. Both are already in `.gitignore`.

### 4. Load the demo data

```bash
npm run db:reset
```

This builds the tables and loads sample users, trips, destinations and past spending. It **wipes the database first**, so don't run it against a database with data you care about. At the end it may say it skipped `timescale.sql`. That's expected on plain PostgreSQL.

### 5. Start it

```bash
npm run dev
```

The backend runs on http://localhost:8080 and the app opens at http://localhost:3000. Log in as `tom` (London, GBP), `amara` (Lagos, NGN) or `lucia` (Madrid, EUR), all with the password `demo1234`. Press Ctrl+C to stop.

### Other commands

```bash
npm --prefix code/backend test   # run the unit tests
npm run snowflake:sync           # push anonymised data to Snowflake
npm run flights:refresh          # fetch fresh live flight prices
```

**About the sample data:** destinations, reference prices and past-group spending are seeded sample data. They live in real tables and are read through real queries, and the app labels them "sample" where they appear. Destination photos are from Wikimedia Commons (see `code/frontend/public/images/destinations/CREDITS.md`).

## Running it on a server (how we host it on Vultr)

In production, one Node process serves both the API and the built React app on port 8080. Caddy sits in front of it and handles HTTPS. Our live copy runs on a Vultr Ubuntu 24.04 server at https://wisepiggy.club.

### Setting up a new server

1. **Create the server.** Any Ubuntu 24.04 VPS works. 1 GB of RAM is enough, and the setup script adds swap for the build.
2. **Point your domain at it.** At your domain registrar (ours is Porkbun), delete any default "parked" records and add two:
   - `A` with an empty host, pointing to the server's IP
   - `A` with host `www`, pointing to the server's IP
3. **On the server, as root, clone the repo and run the setup script:**
   ```bash
   git clone https://github.com/josie-collins/iku-hackathon.git /opt/wise-piggy
   bash /opt/wise-piggy/deploy/setup-server.sh yourdomain.com
   ```
   This installs Node 22, Caddy and a firewall, creates a `wisepiggy` user to run the app, and installs the service and the Caddyfile. Before running it, change the domain in `deploy/Caddyfile` if yours isn't wisepiggy.club.
4. **From your laptop, copy your secrets to the server.** They never go through git.
   ```bash
   scp code/backend/.env root@SERVER_IP:/opt/wise-piggy/code/backend/.env
   scp code/backend/keys/snowflake.p8 root@SERVER_IP:/opt/wise-piggy/code/backend/keys/
   ```
   Then, on the server, give the files to the app user and lock them down:
   ```bash
   chown -R wisepiggy:wisepiggy /opt/wise-piggy/code/backend
   chmod 600 /opt/wise-piggy/code/backend/.env /opt/wise-piggy/code/backend/keys/*
   ```
   In the server's `.env`, set:
   - `DATABASE_URL` to the server's database. Your laptop's `localhost` one won't work there.
   - a new `JWT_SECRET`. Generate one with `openssl rand -hex 32`.
5. **If you want the database on the same server:**
   ```bash
   apt-get install -y postgresql
   sudo -u postgres psql -c "CREATE USER wisepiggy WITH PASSWORD 'pick-a-password';" -c "CREATE DATABASE tripplanner OWNER wisepiggy;"
   ```
   Then set `DATABASE_URL=postgresql://wisepiggy:pick-a-password@localhost:5432/tripplanner` in the server's `.env`.
6. **Build and start:**
   ```bash
   bash /opt/wise-piggy/deploy/deploy.sh
   ```
   It finishes with `✔ Wise Piggy is running`.
7. **Load the demo data** (first time only, since it wipes the database):
   ```bash
   sudo -u wisepiggy bash -c "cd /opt/wise-piggy/code/backend && npm run db:reset" && systemctl restart wise-piggy
   ```
   Once DNS has updated, open your domain. Caddy gets the HTTPS certificate on the first visit.

### Updating the live site

Push to `main` on GitHub, then on the server:

```bash
bash /opt/wise-piggy/deploy/deploy.sh --pull
```

Our own server was set up by hand during the hackathon, before these scripts existed. It runs the app as root rather than as a `wisepiggy` user, so we update it like this instead:

```bash
cd /opt/wise-piggy && git pull origin main \
  && cd code/frontend && npm install && npm run build \
  && systemctl restart wise-piggy
```

If you only changed `.env`, `systemctl restart wise-piggy` is enough. The app reads it when it starts.

### When something goes wrong

| Question | Command |
| --- | --- |
| Is the app running? | `systemctl status wise-piggy` |
| What is it saying? | `journalctl -u wise-piggy -f` |
| Does it answer? | `curl http://localhost:8080/api/health` should print `{"ok":true}` |
| Is HTTPS working? | `journalctl -u caddy -n 50` |
| Does the domain point here? | `dig +short yourdomain.com` should print the server's IP |

If the certificate fails, check DNS first: Caddy can only get one once the domain points at the server.

## AI disclosure

We used AI in two ways: as a **feature inside the app**, and as a **coding and writing assistant** while we built it. Everything else is our own work.

### AI inside the app

| Feature | AI used | What we built ourselves |
| --- | --- | --- |
| Reading receipts: total, currency, shop, category and item lines | Gemini API | The prompt, the JSON schema, validation, converting amounts to minor units in our code (not the model's), the fallback model and the manual-entry fallback |
| Turning a spoken expense into a draft | ElevenLabs speech-to-text, then Gemini | The prompt, matching names to people in code, and the confirm step. Nothing is saved until you confirm. |
| Reading back what was saved | ElevenLabs text-to-speech | The sentence itself, which our code builds from the saved split |
| "Why this fits" reasons | Snowflake Cortex (template fallback on trial accounts) | The money-free input, and a filter that throws away replies mentioning money |

AI never decides anything about money. Every budget check, split, conversion and settlement is plain code with unit tests.

### AI as a development tool

| Area | AI tool | How we used it | What we did ourselves |
| --- | --- | --- | --- |
| Product idea, problem, privacy rules, budget logic design | None | — | Our own idea, refined with input from people at Wise |
| Gemini receipt integration and per-item split | Claude Code | Helped write the Gemini call and schema, the split maths and the item editor | Designed the feature, tested it on real receipts, reviewed and debugged the code |
| Voice entry and spoken read-back | Claude Code | Helped write the ElevenLabs calls, the transcript prompt and the browser recording | Chose the models and flow, tested it by voice |
| Merging branches | Claude Code | Helped resolve merge conflicts | Reviewed every resolution and checked the app still ran |
| Deployment to Vultr | Claude Code | Walked us through DNS, HTTPS, the service and database setup | Ran every command on the server and checked the live site |
| Docs, README, Devpost text and pitch deck | Claude, Canva AI | Claude helped structure and edit the writing; Canva AI laid out the slides | Decided the content and every claim, and reviewed everything |

Everything else, including the budget, ceiling and settle-up logic, the database, and the Wise, flights and Snowflake integrations, we wrote and tested ourselves.

## What's next

- An agent that re-plans when a flight price jumps, a stay sells out or someone drops out
- A screen for the private "would you stretch slightly above your number?" question. The logic is already there.
- Asking everyone privately, at the same time, before the group ever hears "nothing fits"
- Two-track days: a shared plan everyone can afford, plus optional extras people join privately
- Searching and voting on stays, with Booking.com and Airbnb links
- Trip Wrapped: a shareable recap with group totals only
- Settling up inside Wise itself, rather than through a link
