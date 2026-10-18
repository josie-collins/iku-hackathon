# Trip spending insights: a Streamlit in Snowflake dashboard.
#
# Reads the ANONYMISED tables that `npm run snowflake:sync` writes to
# TRIP_PLANNER.ANALYTICS (TRIPS, DAILY_SPEND). There are no budgets, names or
# user ids in them, personal spending is never synced, and trips with fewer
# than 3 people are left out.
#
# Deploy: Snowsight > Projects > Streamlit > + Streamlit App, using warehouse
# TRIP_WH and location TRIP_PLANNER.ANALYTICS, then paste this file in.

import altair as alt
import pandas as pd
import streamlit as st
from snowflake.snowpark.context import get_active_session

st.set_page_config(page_title="Trip spending insights", layout="wide")

# Validated categorical slots (blue, orange): pass CVD and contrast checks on a light surface.
BLUE = "#2a78d6"
ORANGE = "#eb6834"
AQUA = "#1baf7a"  # below 3:1 on light: the split is also in the table view
CONTEXT_GREY = "#c3c2b7"  # non-highlighted bars when one month is the point
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
GRID = "#e6e5e1"
TEXT_MUTED = "#52514e"

session = get_active_session()

# Full names, so the app finds the tables wherever it was created (a workspace, a
# different schema) and whatever its session's current schema is.
SCHEMA = "TRIP_PLANNER.ANALYTICS"


@st.cache_data(ttl=600)
def load():
    trips = session.sql(
        f"SELECT TRIP_KEY, DESTINATION_CITY, COUNTRY_CODE, STATUS, GROUP_SIZE, NIGHTS, TRIP_MONTH FROM {SCHEMA}.TRIPS"
    ).to_pandas()
    spend = session.sql(
        f"""SELECT TRIP_KEY, DESTINATION_CITY, SPENT_ON, CATEGORY, GROUP_SIZE,
                   TOTAL_EUR_MINOR, PER_PERSON_EUR_MINOR, IS_SAMPLE, SYNCED_AT
            FROM {SCHEMA}.DAILY_SPEND"""
    ).to_pandas()
    try:
        places = session.sql(
            f"""SELECT CITY, COUNTRY_CODE, STAY_PP_NIGHT_EUR_MINOR, FOOD_PP_DAY_EUR_MINOR, ACTIVITIES_PP_DAY_EUR_MINOR
                FROM {SCHEMA}.DESTINATIONS"""
        ).to_pandas()
    except Exception:  # synced before DESTINATIONS existed: run the sync again
        places = pd.DataFrame()
    return trips, spend, places


def euros(minor):
    return f"€{minor / 100:,.2f}"


def style(chart):
    """Recessive grid and axes; text in muted ink, never the series colour."""
    return (
        chart.configure_axis(gridColor=GRID, domainColor=GRID, tickColor=GRID,
                             labelColor=TEXT_MUTED, titleColor=TEXT_MUTED, labelFontSize=12)
        .configure_view(strokeWidth=0)
        .configure_legend(labelColor=TEXT_MUTED, titleColor=TEXT_MUTED, orient="top")
    )


trips, spend, places = load()

st.title("Trip spending insights")
st.caption(
    "Anonymised data from the group trip planner: no budgets, names or user ids, no personal spending, "
    "and no trips with fewer than 3 people. Amounts are in EUR, per person."
)

if spend.empty:
    st.info("No data yet. Run `npm run snowflake:sync` from the app to load it.")
    st.stop()

# ---- Filters: one row, above the charts ---------------------------------------------
f1, f2 = st.columns([1, 3])
with f1:
    include_sample = st.toggle("Include sample past-group data", value=True)
with f2:
    # Both tables: a booked trip can have no spending yet
    cities = sorted(set(spend["DESTINATION_CITY"].dropna()) | set(trips["DESTINATION_CITY"].dropna()))
    chosen = st.multiselect("Cities", cities, default=cities)

data = spend[spend["DESTINATION_CITY"].isin(chosen)]
if not include_sample:
    data = data[~data["IS_SAMPLE"]]
if data.empty:
    st.warning("Nothing matches these filters.")
    st.stop()

# One row per trip-day: per-person spend that day, across categories.
days = (
    data.groupby(["DESTINATION_CITY", "TRIP_KEY", "SPENT_ON"], as_index=False)
    .agg(PER_PERSON=("PER_PERSON_EUR_MINOR", "sum"), IS_SAMPLE=("IS_SAMPLE", "all"))
)
days["SOURCE"] = days["IS_SAMPLE"].map({True: "Sample data", False: "Real trips"})

# ---- Headline numbers -----------------------------------------------------------------
real_trips = trips[trips["DESTINATION_CITY"].isin(chosen)]
k1, k2, k3, k4 = st.columns(4)
k1.metric("Average per person per day", euros(days["PER_PERSON"].mean()))
k2.metric("Trip-days of spending", f"{len(days):,}")
k3.metric("Cities", days["DESTINATION_CITY"].nunique())
k4.metric("Real trips synced", len(real_trips))

# ---- Spend per person per day, by city ----------------------------------------------
by_city = (
    days.groupby("DESTINATION_CITY", as_index=False)
    .agg(PER_PERSON=("PER_PERSON", "mean"), TRIP_DAYS=("PER_PERSON", "size"))
    .sort_values("PER_PERSON", ascending=False)
)
by_city["PER_PERSON_EUR"] = by_city["PER_PERSON"] / 100

left, right = st.columns(2)
with left:
    st.subheader("Spend per person per day, by city")
    chart = (
        alt.Chart(by_city)
        .mark_bar(color=BLUE, cornerRadiusEnd=4, height={"band": 0.7})
        .encode(
            y=alt.Y("DESTINATION_CITY:N", sort="-x", title=None),
            x=alt.X("PER_PERSON_EUR:Q", title="EUR per person per day", axis=alt.Axis(format="€,.0f")),
            tooltip=[
                alt.Tooltip("DESTINATION_CITY:N", title="City"),
                alt.Tooltip("PER_PERSON_EUR:Q", title="Per person per day", format="€,.2f"),
                alt.Tooltip("TRIP_DAYS:Q", title="Trip-days"),
            ],
        )
        .properties(height=max(220, 32 * len(by_city)))
    )
    st.altair_chart(style(chart), use_container_width=True)

# ---- Where the data comes from: real vs sample trip-days ----------------------------
with right:
    st.subheader("Real trips vs sample data")
    source = days.groupby(["DESTINATION_CITY", "SOURCE"], as_index=False).size().rename(columns={"size": "TRIP_DAYS"})
    chart = (
        alt.Chart(source)
        .mark_bar(stroke="white", strokeWidth=2, height={"band": 0.7})
        .encode(
            y=alt.Y("DESTINATION_CITY:N", sort=by_city["DESTINATION_CITY"].tolist(), title=None),
            x=alt.X("TRIP_DAYS:Q", title="Trip-days of spending", stack="zero"),
            color=alt.Color(
                "SOURCE:N",
                title=None,
                scale=alt.Scale(domain=["Real trips", "Sample data"], range=[BLUE, ORANGE]),
            ),
            order=alt.Order("SOURCE:N", sort="ascending"),
            tooltip=[
                alt.Tooltip("DESTINATION_CITY:N", title="City"),
                alt.Tooltip("SOURCE:N", title="Source"),
                alt.Tooltip("TRIP_DAYS:Q", title="Trip-days"),
            ],
        )
        .properties(height=max(220, 32 * len(by_city)))
    )
    st.altair_chart(style(chart), use_container_width=True)

# ---- Spend by category ----------------------------------------------------------------
# Each category's share of an average trip-day, so the bars add up to the daily average.
by_category = data.groupby("CATEGORY", as_index=False)["PER_PERSON_EUR_MINOR"].sum()
by_category["PER_PERSON_EUR"] = by_category["PER_PERSON_EUR_MINOR"] / len(days) / 100
by_category = by_category.sort_values("PER_PERSON_EUR", ascending=False)

left, right = st.columns(2)
with left:
    st.subheader("What the money goes on")
    chart = (
        alt.Chart(by_category)
        .mark_bar(color=BLUE, cornerRadiusEnd=4, height={"band": 0.7})
        .encode(
            y=alt.Y("CATEGORY:N", sort="-x", title=None),
            x=alt.X("PER_PERSON_EUR:Q", title="EUR per person per day", axis=alt.Axis(format="€,.0f")),
            tooltip=[
                alt.Tooltip("CATEGORY:N", title="Category"),
                alt.Tooltip("PER_PERSON_EUR:Q", title="Per person per day", format="€,.2f"),
            ],
        )
        .properties(height=max(200, 36 * len(by_category)))
    )
    st.altair_chart(style(chart), use_container_width=True)

# ---- Trip lengths (real trips only: sample data has no trips) -----------------------
with right:
    st.subheader("How long trips are")
    if real_trips.empty:
        st.caption("No real trips synced for these cities yet.")
    else:
        lengths = real_trips.copy()
        lengths["LENGTH"] = lengths["NIGHTS"].map(
            lambda n: "Day trip" if n == 0 else ("Not booked" if pd.isna(n) else f"{int(n)} nights")
        )
        lengths["ORDER"] = lengths["NIGHTS"].fillna(999)
        counts = lengths.groupby(["LENGTH", "ORDER"], as_index=False).size().rename(columns={"size": "TRIPS"})
        chart = (
            alt.Chart(counts)
            .mark_bar(color=BLUE, cornerRadiusEnd=4, width={"band": 0.6})
            .encode(
                x=alt.X("LENGTH:N", sort=alt.EncodingSortField("ORDER"), title=None, axis=alt.Axis(labelAngle=0)),
                y=alt.Y("TRIPS:Q", title="Trips", axis=alt.Axis(tickMinStep=1, format="d")),
                tooltip=[alt.Tooltip("LENGTH:N", title="Length"), alt.Tooltip("TRIPS:Q", title="Trips")],
            )
            .properties(height=260)
        )
        st.altair_chart(style(chart), use_container_width=True)

# ---- A typical day per destination: stay, food, activities --------------------------
split = pd.DataFrame()
if not places.empty:
    st.subheader("A typical day per destination")
    st.caption("Reference costs per person: one night's stay, a day's food and a day's activities. Sample data.")
    split = places[places["CITY"].isin(chosen)].melt(
        id_vars=["CITY"],
        value_vars=["STAY_PP_NIGHT_EUR_MINOR", "FOOD_PP_DAY_EUR_MINOR", "ACTIVITIES_PP_DAY_EUR_MINOR"],
        var_name="PART", value_name="MINOR",
    )
    split["PART"] = split["PART"].map({
        "STAY_PP_NIGHT_EUR_MINOR": "Stay", "FOOD_PP_DAY_EUR_MINOR": "Food", "ACTIVITIES_PP_DAY_EUR_MINOR": "Activities",
    })
    split["EUR"] = split["MINOR"] / 100
    order = split.groupby("CITY")["EUR"].sum().sort_values(ascending=False).index.tolist()
    parts = ["Stay", "Food", "Activities"]
    chart = (
        alt.Chart(split)
        .mark_bar(stroke="white", strokeWidth=2, height={"band": 0.7})
        .encode(
            y=alt.Y("CITY:N", sort=order, title=None),
            x=alt.X("EUR:Q", title="EUR per person per day", stack="zero", axis=alt.Axis(format="€,.0f")),
            color=alt.Color("PART:N", title=None, sort=parts, scale=alt.Scale(domain=parts, range=[BLUE, ORANGE, AQUA])),
            order=alt.Order("PART_ORDER:Q"),
            tooltip=[
                alt.Tooltip("CITY:N", title="City"),
                alt.Tooltip("PART:N", title="Part"),
                alt.Tooltip("EUR:Q", title="Per person", format="€,.2f"),
            ],
        )
        .transform_calculate(PART_ORDER="indexof(['Stay','Food','Activities'], datum.PART)")
        .properties(height=max(240, 30 * len(order)))
    )
    st.altair_chart(style(chart), use_container_width=True)

# ---- Cheapest month to go ---------------------------------------------------------------
days["MONTH"] = pd.to_datetime(days["SPENT_ON"]).dt.month
monthly = days.groupby(["DESTINATION_CITY", "MONTH"], as_index=False)["PER_PERSON"].mean()
months_per_city = monthly.groupby("DESTINATION_CITY")["MONTH"].nunique()
comparable = sorted(months_per_city[months_per_city >= 3].index)

st.subheader("Cheapest month to go")
if not include_sample:
    st.caption("Mostly sample data: turn sample data back on to compare months.")
if not comparable:
    st.info("Not enough data yet: a city needs at least 3 months of spending to compare months.")
else:
    st.caption(
        "Average spend per person per day in each month. The year of sample data uses a made-up seasonal "
        "pattern for the demo, so treat it as illustrative, not as real prices."
    )
    city = st.selectbox("Destination", comparable)
    one = monthly[monthly["DESTINATION_CITY"] == city].copy()
    one["EUR"] = one["PER_PERSON"] / 100
    one["MONTH_NAME"] = one["MONTH"].map(lambda m: MONTHS[m - 1])
    cheapest = one.loc[one["EUR"].idxmin()]
    one["IS_CHEAPEST"] = one["MONTH"] == cheapest["MONTH"]
    saving = 1 - cheapest["EUR"] / one["EUR"].mean()

    m1, m2 = st.columns(2)
    m1.metric(f"Cheapest month in {city}", cheapest["MONTH_NAME"], help="Lowest average spend per person per day")
    m2.metric("Compared with the yearly average", f"€{cheapest['EUR']:,.2f} a day", f"{saving:.0%} cheaper", delta_color="off")

    chart = (
        alt.Chart(one)
        .mark_bar(cornerRadiusEnd=4, width={"band": 0.7})
        .encode(
            x=alt.X("MONTH_NAME:N", sort=MONTHS, title=None, axis=alt.Axis(labelAngle=0)),
            y=alt.Y("EUR:Q", title="EUR per person per day", axis=alt.Axis(format="€,.0f")),
            # Emphasis: the cheapest month in blue, the rest as grey context
            color=alt.condition(alt.datum.IS_CHEAPEST, alt.value(BLUE), alt.value(CONTEXT_GREY)),
            tooltip=[
                alt.Tooltip("MONTH_NAME:N", title="Month"),
                alt.Tooltip("EUR:Q", title="Per person per day", format="€,.2f"),
            ],
        )
        .properties(height=280)
    )
    st.altair_chart(style(chart), use_container_width=True)

    best = (
        monthly[monthly["DESTINATION_CITY"].isin(comparable)]
        .sort_values("PER_PERSON")
        .groupby("DESTINATION_CITY", as_index=False)
        .first()
    )
    best["Cheapest month"] = best["MONTH"].map(lambda m: MONTHS[m - 1])
    best["Per person per day"] = best["PER_PERSON"].map(euros)
    st.write("**Cheapest month for every destination**")
    st.dataframe(
        best[["DESTINATION_CITY", "Cheapest month", "Per person per day"]].rename(columns={"DESTINATION_CITY": "City"}),
        hide_index=True,
    )

# ---- Table views (every chart's numbers, for screen readers and checking) -----------
with st.expander("See the numbers as tables"):
    st.write("**Per person per day, by city**")
    st.dataframe(
        by_city.assign(**{"Per person per day": by_city["PER_PERSON"].map(euros)})
        [["DESTINATION_CITY", "Per person per day", "TRIP_DAYS"]]
        .rename(columns={"DESTINATION_CITY": "City", "TRIP_DAYS": "Trip-days"}),
        hide_index=True,
    )
    st.write("**By category**")
    st.dataframe(
        by_category.assign(**{"Per person per day": (by_category["PER_PERSON_EUR"] * 100).map(euros)})
        [["CATEGORY", "Per person per day"]].rename(columns={"CATEGORY": "Category"}),
        hide_index=True,
    )
    if not split.empty:
        st.write("**A typical day per destination**")
        st.dataframe(
            split.pivot_table(index="CITY", columns="PART", values="EUR")
            .reindex(columns=["Stay", "Food", "Activities"])
            .apply(lambda col: col.map(lambda v: f"€{v:,.2f}"))  # works on older pandas too
            .reset_index()
            .rename(columns={"CITY": "City"}),
            hide_index=True,
        )
    st.write("**Trips**")
    st.dataframe(
        real_trips[["DESTINATION_CITY", "COUNTRY_CODE", "STATUS", "GROUP_SIZE", "NIGHTS", "TRIP_MONTH"]]
        .rename(columns=str.title),
        hide_index=True,
    )

synced = spend["SYNCED_AT"].max()
st.caption(f"Last synced: {synced}. Sample data is seeded for the demo and labelled as such.")
