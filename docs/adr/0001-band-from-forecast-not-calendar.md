# Band is derived from forecast temperature, not the calendar

Shutter rules used to be selected by a `season` computed from the month, and
only `summer` had rules. On 01-09-2026 the planner flipped to `autumn`, found
no rules, and scheduled nothing — silently, for three days, on days reaching
27 °C. The calendar cannot tell a hot September day from a mild one.

A day's **band** is now derived from its forecast daily maximum at Cardona:
`hot` above 28 °C, `mild` from 18 to 28 °C, `cold` below 18 °C. Against the
2025-09 → 2026-08 archive that splits the year 101 / 120 / 144 days, and
September into 5 hot and 25 mild.

## Consequences

Only `hot` carries rules. `mild` and `cold` are deliberately empty, so on
roughly 264 days a year the planner correctly schedules nothing. **An empty
band is a legitimate outcome, not a fault** — which is why "zero jobs
scheduled" must never be treated as an error condition. Winter behaviour can
be added by filling those bands in; nothing else needs to change.

The band depends on a network call, so the 7-day forecast response is cached
and a failed fetch falls back to the stored value for today. Only a
week-long outage leaves the day without a band.

Thresholds are configuration, not constants in code: they are a comfort
judgement about one house and will be tuned after a season of living with
them. Days near a boundary flip band between neighbours — 42 band changes a
year, 15 of them single-day. Accepted without hysteresis while `mild`
remains empty.
