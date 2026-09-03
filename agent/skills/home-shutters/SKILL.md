---
name: home-shutters
description: Control or inspect the Cardona house shutters over MQTT. Use when Marc asks to open, close, stop, position, list, or check a shutter.
---

# Home Shutters

Use `control_shutters` for immediate movement and `shutter_status` for retained
state. Use the exact device names exposed by the tool schema. Never claim a
movement succeeded unless the tool succeeded.

For scheduled behaviour, use the `shutter-manager` skill instead.
