# my-esphome

Home automation for the Cardona house: ESPHome device firmware, and the
agent-driven scheduling that decides when those devices act.

## Language

### Shutter scheduling

**Shutter**:
A motorised window blind driven by a Shelly relay. Named `persiana-<room>`.
_Avoid_: blind, cover, persiana (in prose)

**Band**:
The thermal character of a single day — `hot`, `mild`, or `cold` — which
selects the set of shutter rules in force that day. Replaces the earlier
calendar-based `season`, which could not tell a hot September day from a
mild one.
_Avoid_: season, mode, profile

**Daily max**:
The highest air temperature forecast for the current day at Cardona. The
sole input that decides the band.
_Avoid_: temperature, forecast temp

**Override**:
A manually chosen band that replaces the forecast-derived one for the
current day only. Expires unattended; it never carries into tomorrow.
_Avoid_: manual mode, force, pin

**Rule**:
A statement that a group of shutters opens or closes at a given trigger.
Rules belong to exactly one band.

**Trigger**:
The moment a rule fires — either a solar event (sunrise, solar zenith,
sunset) with an optional offset, or a fixed clock time.

**Time slot**:
All shutter movements falling in the same minute, executed together over a
single broker connection.

**Planner**:
The nightly process that resolves the day's band, expands its rules into
time slots, and schedules each one. It is deterministic and involves no
language model.

**Home Agent**:
The standalone bot that owns shutter scheduling: it runs the Planner, holds
the day's time slots, drives the relays, and takes an Override over
Telegram.
_Avoid_: gordita, the bot, hermes

**Empty band**:
A band with no rules, meaning the shutters are deliberately left alone all
day. A legitimate state, not a fault.
