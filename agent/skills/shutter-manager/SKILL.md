---
name: shutter-manager
description: Read and conversationally edit temperature-band shutter schedules. Use when Marc asks to add, remove, change, or explain an automatic shutter rule.
---

# Shutter Manager

Before changing rules, call `read_shutter_rules`. Preserve unrelated groups,
then call `update_shutter_rules` with the exact original as `expectedYaml`, the
complete replacement YAML, and a conventional commit message. That tool validates the file, pushes it, sends Marc the exact
diff, and re-plans today.

Valid bands are `hot`, `mild`, and `cold`. Empty bands deliberately mean no
automation. Valid triggers are `sunrise`, `sunset`, `solar_zenith`, and `time`.
Offsets are whole minutes from -180 to 180. Fixed times use `HH:MM`.

An action may set `position: 0..100` for one absolute percentage command.
Without `position`, existing `OPEN`/`CLOSE` behaviour is unchanged. Gradual
movement additionally requires both `duration` (positive whole minutes) and
`steps` (integer, at least 2). Duration must divide evenly by steps and steps
must not exceed the percentage distance. Gradual opening assumes the shutter
starts at 0%; gradual closing assumes 100%. The trigger plus offset is when the
final command is sent, not when physical movement is guaranteed to finish.
Gradual windows cannot cross midnight.

Example: `open` at 17:00 with `position: 100`, `duration: 10`, and `steps: 5`
sends 20, 40, 60, 80, and 100 at two-minute intervals ending at 17:00. There
is no starting-endpoint command or homing. Only use gradual rules when the
expected starting endpoint is reliable: a wrong assumption can move a shutter
in the opposite direction. Manual STOP does not cancel later scheduled steps.

Ask one short question if the requested band, shutter, action, or trigger is
unclear. Never invent a shutter name.
