# Shutter Control System

Automated shutter system for the Cardona property. Shutters are controlled via MQTT commands to Shelly relays. A daily planner reads YAML rules, calculates solar event times for the current day, and creates one-shot cron jobs for each shutter action.

## Components

### Rules file: `shutter_rules.yaml`

Season-based configuration. Each season contains a list of rule groups. Each group specifies:

- `entities`: List of shutter device names (matching the MQTT topic prefix, e.g. `persiana-menjador`).
- `open` / `close`: Action to perform.
- `trigger`: `sunrise`, `sunset`, `solar_zenith`, or `time`.
- `offset`: Optional minutes offset from the trigger event.
- `time`: Required when trigger is `time` (format `HH:MM`).

Seasons with empty lists (`autumn: []`, `winter: []`, `spring: []`) produce no jobs. Only `summer` is currently configured.

### Planner: `daily_shutter_planner.py`

Runs daily at 02:00 via a Hermes cron job (`no_agent: true`, script: `run_shutter_planner.sh`). Does three things in sequence:

1. **Cleanup**: Queries `hermes cron list`, finds all jobs with names prefixed `AUTOSHUTTER-ONESHOT_`, removes them and their associated shell scripts. This prevents accumulation of stale jobs from previous days.
2. **Calculate**: Uses the `astral` library to compute sunrise, solar noon, and sunset for Cardona (41.9137N, 1.6786E) for the current date. Determines the current season by month.
3. **Schedule**: For each rule in the active season, calculates the exact trigger time, writes a one-shot shell script to `$HERMES_HOME/scripts/`, and creates a Hermes cron job (`--no-agent --repeat 1`) that runs that script.

### Wrapper: `run_shutter_planner.sh`

Shell wrapper that invokes `daily_shutter_planner.py` with the venv Python and appends output to `planner.log`. Lives at `$HERMES_HOME/scripts/run_shutter_planner.sh`.

### Shutter control: `shutters.py`

Located at `/opt/data/skills/home-automation/home-shutters/scripts/shutters.py`. Sends MQTT commands to Shelly relays. Each one-shot script calls:

```
/opt/data/home-automation/venv/bin/python shutters.py control <device> '<open|close|stop|0-100>'
```

Connects to the MQTT broker at `10.0.20.20` using credentials from `secrets.yaml`. Publishes to `<device>/cover/blind/command` (for OPEN/CLOSE/STOP) or `<device>/cover/blind/position/command` (for numeric position 0-100).

### Secrets: `secrets.yaml`

Contains `mqtt_broker_address`, `mqtt_broker_username`, `mqtt_broker_password`. Read by `shutters.py` at runtime.

### Log: `planner.log`

Appended to on each planner run. Contains timestamped output of cleanup and scheduling operations.

### Virtualenv: `venv/`

Python virtual environment with `astral`, `pyyaml`, and `paho-mqtt`. Used by both `daily_shutter_planner.py` and `shutters.py`.

## Script paths

All cron scripts must reside in `$HERMES_HOME/scripts/` (`/opt/data/scripts/`). The Hermes cron scheduler resolves script paths relative to this directory. The planner uses `os.environ.get("HERMES_HOME")` to determine this path at runtime. Do not hardcode `~/.hermes/scripts/` -- that resolves to a different directory when `HOME` and `HERMES_HOME` differ.

## One-shot job lifecycle

1. Planner creates a shell script named `autoshutter_<HHMM>_<action>_<device>.sh` in `$HERMES_HOME/scripts/`.
2. Planner creates a Hermes cron job with `--no-agent --repeat 1` and a one-shot ISO timestamp schedule.
3. At the scheduled time, the Hermes scheduler runs the script via `/bin/bash`.
4. The script calls `shutters.py control <device> <action>`, which publishes an MQTT command.
5. On the next planner run, the cleanup step removes the job and script.

One-shot jobs have a 120-second grace window. Jobs more than 120 seconds past their scheduled time are skipped and never fire. If the planner runs late (e.g. at 07:00 instead of 02:00), any actions scheduled before that time are lost for the day.

## Devices

Nine shutters, all on static IPs in the `10.0.20.0/24` subnet:

| Device | IP | Hardware |
|---|---|---|
| persiana-cuina-sud | 10.0.20.50 | Shelly 2.5 |
| persiana-cuina-pica | 10.0.20.51 | Shelly 2.5 |
| persiana-menjador | 10.0.20.52 | Shelly 2.5 |
| persiana-marc-piscina | 10.0.20.53 | Shelly Plus 2 |
| persiana-marc-nord | 10.0.20.54 | Shelly Plus 2 |
| persiana-dormitori | 10.0.20.55 | Shelly 2.5 |
| persiana-bany | 10.0.20.56 | Shelly 2.5 |
| persiana-conills | 10.0.20.57 | Shelly 2.5 |
| persiana-habitacio-sud | 10.0.20.58 | Shelly 2.5 |

## Current summer rules

| Group | Devices | Open | Close |
|---|---|---|---|
| Living Room and Pool | menjador, marc-piscina | solar zenith | sunset |
| Kitchen Sink | cuina-pica | solar zenith -60min | sunrise +30min |
| South-Facing (heat protection) | cuina-sud, habitacio-sud | 17:00 | 10:00 |
| Bathroom and Rabbits | bany, conills | sunset | solar zenith +60min |

## Editing rules

Edit `shutter_rules.yaml` directly or instruct the Hermes agent conversationally. Changes take effect on the next planner run (02:00). To apply immediately:

```bash
/opt/data/home-automation/venv/bin/python /opt/data/home-automation/daily_shutter_planner.py
```
