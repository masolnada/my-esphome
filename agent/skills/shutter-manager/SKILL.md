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

Ask one short question if the requested band, shutter, action, or trigger is
unclear. Never invent a shutter name.
