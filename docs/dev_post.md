# Budget Group Trip Planner

**Tagline:** Transparent costs, private budgets.

**Track:** Wise: Max Ease

**Side challenges:** ElevenLabs, MLH Best Use of Gemini API, MLH Best Use of Snowflake API, Vultr, GoDaddy

## Inspiration

We've all experienced how complicated planning a group trip can get before anyone has even booked anything. One person suggests a weekend away, someone else is trying to save money, and another person ends up coordinating everyone's schedules. Sooner or later, the conversation turns to budgets, and not everyone feels comfortable sharing how much they can afford.

Planning gets even trickier when friends live in different countries. Flights cost different amounts depending on where everyone is travelling from, people use different currencies, and receipts get lost in group chats. We wanted to make travelling with friends about enjoying the trip, not having to explain your personal finances.

## What it does

Everyone enters three budgets privately, using their own currency: a budget for flights, their share of group expenses, and a daily allowance for food and extras. They also enter the dates they're available. Nobody else can see their individual budgets.

The server uses everyone's information to create a shortlist of destinations that **fit everyone's budget**. A destination only makes the list if the flights from each person's airport, their share of accommodation, and their estimated daily food costs all fit within their individual budgets. The group's overall spending limit is calculated on the server and never shared with other members.

Each destination also shows how much previous groups have typically spent there per day. Everyone can vote anonymously, so the group sees the results without knowing who voted for which option. If no destinations fit, everyone receives the same neutral message, without revealing whose budget is limiting the options.

Once the trip begins, you can take a photo of a receipt and Gemini will read its individual items. You then select who had what, and the bill is split according to what each person actually ordered.

You can also record expenses using your voice. For example, you could say, "I paid 42 euros for dinner, Amara had the pasta for twelve." ElevenLabs converts the recording into text, and Gemini turns it into a draft expense for you to review. Once you confirm, ElevenLabs reads back something like, "Saved €42 for Dinner. Amara owes you €12."

Expenses can be shared or personal and can use any currency, with live exchange rates from Wise. Everyone can privately track their spending against their own daily budget.

At the end of the trip, the app calculates who owes whom and finds a way to settle everything with as few payments as possible. Each amount is converted into the payer's home currency, with a link to Wise to make the payment.

## How we built it

- **Frontend:** React.
- **Backend:** Node.js, Express and PostgreSQL. All the core financial logic, including date overlaps, the hidden spending ceiling, destination feasibility, expense splitting, settlement and daily budget tracking, is handled by deterministic code. We wrote 75 unit tests for it.
- **Wise API:** Used for exchange rates. Each expense records the rate, its source and the time it was retrieved. Any fallback rates are clearly labelled.
- **SerpApi (Google Flights):** Provides live flight prices from each member's own airport. We cache results and manage searches carefully to stay within the monthly limit.
- **Gemini API:** Handles receipt scanning and spoken expense descriptions using structured JSON output. A lighter fallback model takes over when the main model is busy. Our code handles currency amounts in minor units rather than leaving that work to the model.
- **ElevenLabs:** Scribe v2 handles speech-to-text, while Eleven v4 Turbo reads out spoken confirmations.
- **Snowflake:** Stores anonymised analytics and powers a Streamlit dashboard showing figures such as how much previous groups spent per day. When available, Cortex generates the "why this trip fits the group requirements" explanations.

Privacy was a key consideration throughout the build. AI models never receive anyone's budget. Gemini only receives receipt images, transcripts and member names, while Cortex receives destination tags, the number of nights and the month.

## Challenges we ran into

- **Keeping budgets private without making the app less useful.** We made sure every response contains only explicitly approved fields. If a live flight price rules out a destination, the group isn't told whose flight caused the issue.

- **Splitting receipts fairly.** Item prices don't always add up neatly to the receipt total because of tax, tips and discounts. We distribute the total proportionally based on each person's items, using integer minor units and largest-remainder rounding to make sure the final shares always add up correctly.

- **Handling different currencies.** Google Flights doesn't support NGN, so searches for those users run in EUR and are converted using Wise exchange rates. We also had to account for currencies that don't use decimal subdivisions.

- **Working around API limits during a 24-hour build.** Gemini sometimes returned "high demand" errors, so we added a fallback model. SerpApi's free plan only allows 250 searches per month, which meant caching prices and keeping some searches in reserve. Snowflake Cortex wasn't available on trial accounts, so we added a template-based fallback for destination explanations.

- **Merging two people's work at 3 a.m.** Both the Gemini and voice branch and the main branch had changes to the expenses code. Bringing everything together meant carefully resolving conflicts and checking that the features still worked.

- **Finding out the Gemini "free credits" weren't actually available.** We activated the Google student offer expecting the monthly Google Cloud credits associated with Google AI subscriptions. After digging through the documentation, we realised the free student plan was Google AI Plus. The credits ($10 per month, not £10) were only included with Google AI Pro and Ultra.

  Creating an API key in AI Studio was straightforward, but the paid tier required a minimum prepaid top-up. Even Pro users were reporting a known synchronisation issue between developer credits and the newer prepayment system. The relevant information was spread across Google One help pages, Developer Program FAQs, AI Studio billing documentation and forum discussions, with each source explaining only part of the situation.

  **How we solved it:** Instead of getting stuck on billing, we built the project using the free tier of the Gemini API. We used gemini-3.8-flash as our main model and lighter Flash-Lite models for simpler tasks. We also designed the app around the free-tier rate limits, allowing the project to run at no cost.

- **Getting voice recording lengths right for ElevenLabs.** Recordings needed to be long enough to capture a complete sentence, such as "Amara had the pasta for twelve", but short enough to transcribe quickly and stay within our credits. We settled on recordings that automatically stop after 30 seconds.

## Accomplishments that we're proud of

- Helping a group go from having no plan to choosing a destination without anyone needing to disclose their budget.
- Building receipt scanning that splits costs by item, alongside voice entry that understands descriptions like "Amara had the pasta" and confirms the saved expense aloud.
- Making it possible to settle expenses across GBP, NGN and EUR without anyone having to calculate exchange rates manually.
- Making sure every fallback is labelled with its source, so the app stays transparent when a service is unavailable.

## What we learned

- Privacy needs to be built into the data the server returns, not just the information hidden in the interface.
- AI is most useful for handling messy inputs and making interactions feel natural. Financial calculations are better handled by deterministic, tested code.
- Structured output and a strict schema made Gemini much more reliable to work with.
- It's worth checking the actual plan name and pricing details before choosing a model. The Gemini free tier turned out to be enough for a working prototype.

## What's next for Budget Group Trip Planner

- A re-planning agent that responds when flight prices rise, finding accommodation, handling the logic when it sells out or someone drops out of the trip.
- Private prompts asking everyone whether they'd be willing to stretch their budget slightly, before the group is told that no destinations fit.
- Two-track itineraries with a shared core plan and optional activities that people can join privately.
- Accommodation search and voting, followed by Trip Wrapped, a shareable recap that shows group totals without revealing individual spending.
- A deeper Wise integration that lets users settle expenses directly within Wise.

## AI disclosure

We used AI in two ways: as part of the app itself and as a coding and writing assistant during development. The product decisions, core financial logic and integrations were built and tested by our team.

### AI inside the app

| Feature | AI used | What we built ourselves |
| --- | --- | --- |
| Reading receipts, including totals, currencies, merchants, categories and individual items | Gemini API | The prompt, JSON schema, validation, conversion to minor units in code, fallback model and manual-entry option |
| Turning spoken expenses into draft expenses with items and people | ElevenLabs speech-to-text, followed by Gemini | The prompt, matching names to users in code and the confirmation step. Nothing is saved until the user confirms. |
| Reading out a confirmation after saving an expense | ElevenLabs text-to-speech | Our code generates the confirmation sentence from the saved expense split. |
| Generating "why this fits" explanations | Snowflake Cortex, with a template fallback for trial accounts | The prompt input, which excludes financial information, and a filter that rejects responses mentioning money |

AI never makes financial decisions and never sees anyone's budget. All budget checks, expense splits, currency conversions and settlements are handled by deterministic code covered by unit tests.


### AI as a development tool

| Area | AI tool | How we used it | What we did ourselves |
| --- | --- | --- | --- |
| Product idea, problem definition, privacy rules and budget logic design | None | Not applicable | Developed our own idea and refined it with input from people at Wise. |
| Gemini receipt integration and per-item splitting | Claude Code | Helped write the Gemini API call, schema, proportional-splitting calculations and item editor. | Designed the feature, tested it on real receipts, and reviewed and debugged the code. |
| Voice entry and spoken confirmations | Claude Code | Helped implement the ElevenLabs calls, transcript prompt and browser recording. | Chose the models and interaction flow, then tested the feature by voice. |
| Merging branches | Claude Code | Helped resolve merge conflicts. | Reviewed each resolution and checked that the app still ran correctly. |
| Deployment to Vultr | Claude Code | Provided step-by-step guidance for DNS, HTTPS using Caddy, service configuration and database setup. | Ran every command on the server and verified the live site. |
| Documentation, README, Devpost text and pitch deck | Claude and Canva AI | Claude helped structure and edit the writing, while Canva AI helped lay out the slides. | Decided on the content and claims, then reviewed everything. |

Everything else, including the budget calculations, hidden spending ceiling, settlement logic, database and Wise, flight search and Snowflake integrations, was written and tested by our team.