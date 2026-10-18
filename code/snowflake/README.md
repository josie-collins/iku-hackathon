# Snowflake

Snowflake is Wise Piggy's analytics warehouse. It only ever holds **anonymised** data: no budgets, names or user IDs, no personal spending, and no trips with fewer than 3 people. The rules are in `code/backend/logic/analytics.js`.

| Piece | Where |
| --- | --- |
| Connection (key-pair auth) | `code/backend/integrations/snowflake.js` |
| Sync: `npm run snowflake:sync` | `code/backend/db/sync-snowflake.js`, which writes `TRIPS`, `DAILY_SPEND` and the `DESTINATION_DAILY_SPEND` view |
| "Past groups spent about €X a day here" on the shortlist | `code/backend/insights.js` (falls back to Postgres) |
| "Why this fits" text from Cortex AI | `code/backend/explanations.js` (falls back to a template reason) |
| Dashboard (Streamlit in Snowflake) | `streamlit_app.py` in this folder |

## Deploy the dashboard

1. **Let the app role own a Streamlit app.** Run this once in a Snowsight worksheet as `ACCOUNTADMIN`, using your own login name:
   ```sql
   GRANT CREATE STREAMLIT, CREATE STAGE ON SCHEMA TRIP_PLANNER.ANALYTICS TO ROLE TRIP_APP;
   GRANT ROLE TRIP_APP TO USER "your.login.name";
   ```
2. In Snowsight, switch your role to **TRIP_APP** (bottom-left menu).
3. Go to **Projects → Streamlit → + Streamlit App**:
   - **Name:** Trip spending insights
   - **Location:** `TRIP_PLANNER` / `ANALYTICS`
   - **Warehouse:** `TRIP_WH`
4. Replace the example code with the contents of `streamlit_app.py`, then click **Run**.

The app runs as `TRIP_APP`, which owns the tables, so it needs no further grants. It reads straight from the synced tables, so run `npm run snowflake:sync` first to get fresh numbers.

## Cortex AI

Shortlist options can get a one-sentence "why this fits your group" reason from `SNOWFLAKE.CORTEX.COMPLETE`. The prompt only contains the destination, its tags, the group's combined trip styles, the number of nights and the month: never money, names or budgets. Replies that mention money are thrown away. Reasons written by Cortex are labelled "Written by Snowflake Cortex AI" in the app.

**Cortex is not available on trial accounts.** On a trial, the app shows a plain template reason instead ("Matches your group's love of beach and culture · 5 nights in June") and logs `AI function COMPLETE is not available for trial accounts` once an hour. Once the account is upgraded, it switches on by itself, with no code changes needed. To use a different model, set `SNOWFLAKE_CORTEX_MODEL` in `.env` (default `mistral-large2`). Each reason is one short Cortex call and costs credits. Reasons are saved, so each shortlist option is only explained once.
