# Shutter Control — Agent Guide

How to control the house shutters programmatically. Written for an automation
agent with access to the MQTT broker; no Home Assistant or ESPHome tooling
required.

## Architecture

Each shutter is a standalone ESPHome node (Shelly 2.5 or Shelly Plus 2) wired
between mains and the shutter motor's up/down windings. There is no central
hub: every node connects independently to the MQTT broker (address and
credentials in `common/secrets.yaml`, keys `mqtt_broker_*`) and exposes exactly
one cover entity named **Blind** (object id `blind`).

The cover is ESPHome's `current_based` platform:

- Position is **dead-reckoned from travel time** (per-device open/close
  durations below). Intermediate positions are estimates.
- The endstop is detected by the **motor current dropping** below a per-device
  threshold, so a full `OPEN` or `CLOSE` self-terminates and recalibrates the
  position to 100 or 0. Prefer full travels over intermediate positions when
  accuracy matters.
- An obstruction during closing triggers a **30% rollback**.
- Direction reversal is safe at any time; the relays are hardware-interlocked
  (150–200 ms dead time between windings).
- **Wall switches operate in parallel** with MQTT. A human can move or stop
  the shutter at any moment, so always trust the state topics over the last
  command you sent.

## MQTT interface

The topic prefix is the hyphenated device name. All state topics are published
retained, so a fresh subscription immediately yields the last known values.

| Topic | Direction | Payload |
|---|---|---|
| `<device>/cover/blind/command` | publish | `OPEN`, `CLOSE`, `STOP` |
| `<device>/cover/blind/position/command` | publish | `0`–`100` (100 = fully open) |
| `<device>/cover/blind/state` | subscribe | `opening`, `closing`, `open`, `closed` |
| `<device>/cover/blind/position/state` | subscribe | `0`–`100` |
| `<device>/status` | subscribe | `online` / `offline` (LWT) |

Example:

```bash
mosquitto_pub -h $BROKER -u $USER -P $PASS -t persiana-dormitori/cover/blind/command -m OPEN
mosquitto_sub -h $BROKER -u $USER -P $PASS -t 'persiana-dormitori/cover/blind/#' -v
```

## Devices

| Device (= topic prefix) | IP | Hardware | Open / close travel |
|---|---|---|---|
| `persiana-cuina-sud` | `10.0.20.50` | Shelly 2.5 | 12 s / 10 s |
| `persiana-cuina-pica` | `10.0.20.51` | Shelly 2.5 | 12 s / 10 s |
| `persiana-menjador` | `10.0.20.52` | Shelly 2.5 | 12 s / 10 s |
| `persiana-marc-piscina` | `10.0.20.53` | Shelly Plus 2 | 17 s / 17 s |
| `persiana-marc-nord` | `10.0.20.54` | Shelly Plus 2 | 17 s / 16.5 s |
| `persiana-dormitori` | `10.0.20.55` | Shelly 2.5 | 12 s / 10 s |
| `persiana-bany` | `10.0.20.56` | Shelly 2.5 | 12 s / 10 s |
| `persiana-conills` | `10.0.20.57` | Shelly 2.5 | 12 s / 10 s |
| `persiana-habitacio-sud` | `10.0.20.58` | Shelly 2.5 | 12 s / 10 s |

Each device also answers on mDNS at `<device>.local`.

## Operational notes

- **Verify motion started**: after publishing a command, expect
  `state` → `opening`/`closing` within ~1 s. No transition usually means the
  device is offline (check `<device>/status`) or the shutter was already at
  that endstop.
- **Travel time budget**: a full travel completes within the durations above
  plus ~1 s of current-sensing delay. If `state` still reports movement well
  past that, something is wrong — send `STOP`.
- **Global automation kill switch**: publishing `ON` to the broker-wide topic
  `halt_automations` pauses on-device automations on every node that includes
  `packages/halt-automations.yaml` (currently `persiana-marc-nord` and
  `persiana-marc-piscina`, plus some lights). It does **not** block direct
  cover commands. Publish `OFF` to resume; the flag survives reboots.
- **Fallback control path**: each device serves an authenticated web UI and
  REST API on port 80 (credentials in `common/secrets.yaml`, keys
  `web_server_*`). MQTT is the primary interface; use HTTP only if the broker
  is unavailable.
