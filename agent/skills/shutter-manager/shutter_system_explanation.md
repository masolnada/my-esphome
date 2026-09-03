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

The planner expands rules into time slots and arms in-process timers. Past
slots are skipped. Fired slot IDs are persisted before MQTT publishing, so a
restart cannot repeat an ambiguous movement. Planning runs again after every
restart, midnight rollover, rule edit, and manual band override.

## Manual override

`/shutter-band hot`, `/shutter-band mild`, or `/shutter-band cold` selects the
band for today and re-plans future slots. `/shutter-band` shows the active band
and remaining slots. The Telegram menu exposes `/shutter_band` because Telegram
does not permit hyphens in registered command names; both spellings work.

Overrides expire naturally when the date changes. Elapsed slots never catch up.

## Conversational rule editing

The pi agent reads and edits only
`agent/skills/shutter-manager/shutter_rules.yaml`. Before commit, the complete
file is checked for known shutters, known triggers, valid `HH:MM` times, and
offsets within ±180 minutes. The bot then commits and pushes the change, sends
the exact diff to Telegram, and re-plans.

Its git guard refuses to commit any other path, including ESPHome firmware.

## MQTT

Time slots publish every command through one MQTT connection with QoS 1 to:

- `<device>/cover/blind/command`: `OPEN`, `CLOSE`, `STOP`
- `<device>/cover/blind/position/command`: `0`–`100`

The broker is `mqtt://mosquitto:1883` on the homelab `proxy_net` network.
