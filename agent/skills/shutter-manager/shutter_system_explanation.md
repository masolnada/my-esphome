# Home Agent shutter automation

`home-agent` is a standalone Telegram bot and pi agent. It owns all automatic
shutter movement; Hermes no longer schedules shutters.

## Daily plan

At startup and shortly after midnight, Home Agent fetches seven days from
Open-Meteo for Cardona. One response supplies today's maximum temperature,
sunrise, and sunset. Solar zenith is the midpoint of sunrise and sunset.

The forecast maximum selects one band:

- `hot`: above 28 °C
- `mild`: 18–28 °C inclusive
- `cold`: below 18 °C

The response is cached under `/data/state`. If fetching fails, today's entry
from the cache is used. Rules come from `shutter_rules.yaml`; empty bands mean
no automatic movement.

The planner expands rules into time slots and arms in-process timers. Existing
rules send `OPEN` or `CLOSE`. An action with `position: 0..100` sends one
absolute percentage command instead. Adding both `duration` and `steps`
expands that action into evenly spaced percentage commands whose final command
is sent at the trigger plus offset. Opening ramps assume a 0% start and closing
ramps assume 100%; they do not read the live position, home first, or guarantee
that physical movement has finished by the final command time. Gradual windows
cannot cross midnight.

Past slots are skipped. Fired slot IDs are persisted before MQTT publishing,
so a restart cannot repeat an ambiguous movement. A restart does not catch up
missed steps, and manual STOP does not cancel later scheduled steps. Planning
runs again after every restart, midnight rollover, rule edit, and manual band
override. A failed replacement plan leaves the existing timers in place.

## Manual override

`/shutter-band hot`, `/shutter-band mild`, or `/shutter-band cold` selects the
band for today and re-plans future slots. `/shutter-band` shows the active band
and remaining slots. The Telegram menu exposes `/shutter_band` because Telegram
does not permit hyphens in registered command names; both spellings work.

Overrides expire naturally when the date changes. Elapsed slots never catch up.

## Conversational rule editing

The pi agent reads and edits only
`agent/skills/shutter-manager/shutter_rules.yaml`. Before commit, the complete
file is checked for known shutters, known triggers, valid `HH:MM` times,
offsets within ±180 minutes, and valid percentage/gradual fields. Gradual
movement requires positive whole-minute `duration`, integer `steps` of at least
2, an evenly divisible interval of at least one minute, and no duplicate rounded
targets. Same-shutter commands in the same minute are deduplicated when equal
and rejected when conflicting. The bot then commits and pushes the change, sends
the exact diff to Telegram, and re-plans.

Its git guard refuses to commit any other path, including ESPHome firmware.

## MQTT

Time slots publish every command through one MQTT connection with QoS 1 to:

- `<device>/cover/blind/command`: `OPEN`, `CLOSE`, `STOP`
- `<device>/cover/blind/position/command`: `0`–`100`

The broker is `mqtt://mosquitto:1883` on the homelab `proxy_net` network.
