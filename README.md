# 🏠 My Smart Home ESPHome Hub

Welcome to my cozy smart home setup! 🌟 This repository contains all my ESPHome device configurations for controlling lights, shutters, and other smart devices around the house.

## 🗂️ Project Structure

```
📁 devices/           # 🔌 All your smart device configs
📁 common/            # 🛠️ Shared configurations (wifi, mqtt, etc.)
📁 hardware/          # 🔧 Hardware-specific templates (Shelly devices)
📁 packages/          # 📦 Reusable functionality packages
🔐 secrets.yaml      # Your secret credentials (gitignored)
```

## 🚀 Quick Start

### Podman

```bash
podman create -it \ 
  --name esphome-dev \
  -p 6052:6052 \
  --cap-add=NET_RAW \ # Allows the container to find devices using mDNS
  -v $PWD:/workspace \
  esphome-dev
podman start esphome-dev
podman exec -it esphome-dev bash
```

NOTE: USB passthrough (`--device /dev/ttyUSB0`) does **not** work through Podman on macOS — Podman's VM (Apple Virtualization) doesn't expose USB-serial devices to the Linux container. For USB flashing on macOS, use the native setup described in [🔌 Manual USB Flashing (macOS)](#-manual-usb-flashing-macos) instead.
---


```bash
# Compile a device
esphome compile devices/llum-cuina.yaml

# Flash over-the-air 📡
esphome run devices/llum-cuina.yaml --device OTA

# Start dashboard 🎛️
devenv tasks run dashboard:serve
```

## 📡 Device Reference: IPs, mDNS & MQTT Actions

All devices publish/subscribe on the broker configured in `common/mqtt.yaml`. Every entity (switches, covers, sensors, lights) is controllable via ESPHome's standard native MQTT topics (`<device-name>/<domain>/<object_id>/command`); the lights table's MQTT column lists only the **custom, hand-written** topics. IPs marked "DHCP" have no static IP configured in ESPHome (`common/wifi.yaml` doesn't currently wire up `manual_ip`, so any `static_ip` substitution is just documentation of an expected router-side DHCP reservation, not an enforced setting). mDNS names follow the ESPHome device name: `<device-name>.local` (also serves the web UI).

### 💡 Lights & fans

| Device | Hardware | Type | IP | mDNS | MQTT Actions |
|---|---|---|---|---|---|
| **llum-cuina** | Shelly Plus RGBW PM | 💡 Light | `10.0.20.34` | `llum-cuina.local` | `llum_cuina/toggle/llum_barra` — toggle bar lights<br>`llum_cuina/toggle/llum_pica` — toggle sink lights<br>`llum_cuina/brightness_cold_white` — set cold-white brightness (`{"brightness": 0.0-1.0}`)<br>`llum_cuina/brightness_warm_white` — set warm-white brightness (`{"brightness": 0.0-1.0}`)<br>`llum_cuina/toggle_effect` — toggle the fade effect |
| **llum-ambient-dormitori** | Shelly RGBW2 | 💡 Light | DHCP | `llum-ambient-dormitori.local` | none custom (standard light entity) |
| **llum-escala** | Shelly Plus 1 | 💡 Light | DHCP | `llum-escala.local` | `llum_escala/auto_trigger` — turns the light on for 5 min if it's currently below horizon (nighttime); no-op during the day |
| **llum-ventilador-marc** | Shelly Plus 2 | 💨 Switch relays (fan/light) | DHCP | `llum-ventilador-marc.local` | none custom (standard switch entities `Output 1`/`Output 2`) |
| **llum-ventilador-marcscave** | Shelly Plus 2 | 💨 Switch relays (fan/light) | DHCP | `llum-ventilador-marcscave.local` | none custom (standard switch entities `Output 1`/`Output 2`) |
| **llum-ventilador-menjador** | Shelly 2.5 | 💨 Switch relays (fan/light) | DHCP | `llum-ventilador-menjador.local` | none custom (standard switch entities) |

### 🪟 Shutters

All shutters expose a standard `cover` entity named `Blind`, driven over MQTT with `<device-name>/cover/blind/command` — payload `OPEN`/`CLOSE`/`STOP`.

**Input types**:
- **Button** — single momentary push-button input; each press advances a state machine that cycles open → stop → close → stop.
- **Dual switch** — latching 3-button wall switch (up/stop/down) with three terminals: SW1, SW2, VCC.

**Motor current** is each motor's measured draw while moving. The `current_based` cover's `*_moving_current_threshold` must sit **below** that device's actual draw (roughly half is a good pick) — never copy a threshold from another device: if the threshold ends up above the real draw, the cover thinks it hit the endstop immediately and cuts the relay after ~1s. Values marked *est.* come from config comments, not a logged measurement.

| Device | Hardware | Input | IP | mDNS | Motor current | Threshold |
|---|---|---|---|---|---|---|
| **persiana-cuina-sud** | Shelly 2.5 | Button | `10.0.20.50` | `persiana-cuina-sud.local` | not measured | 0.5 A |
| **persiana-cuina-pica** | Shelly 2.5 | Button | `10.0.20.51` | `persiana-cuina-pica.local` | 0.8 A (measured) | 0.4 A |
| **persiana-menjador** | Shelly 2.5 | Button | `10.0.20.52` | `persiana-menjador.local` | ~1 A (est.) | 0.5 A |
| **persiana-marc-piscina** | Shelly Plus 2 | Button | `10.0.20.53` | `persiana-marc-piscina.local` | 0.71 A (measured 2026-07) | 0.4 A |
| **persiana-marc-nord** | Shelly Plus 2 | Button | `10.0.20.54` | `persiana-marc-nord.local` | 0.73 A (measured 2026-07) | 0.4 A |
| **persiana-dormitori** | Shelly 2.5 | Dual switch | `10.0.20.55` | `persiana-dormitori.local` | not measured | 0.5 A |
| **persiana-bany** | Shelly 2.5 | Button | `10.0.20.56` | `persiana-bany.local` | ~1 A (est., big shutter) | 0.5 A |
| **persiana-conills** | Shelly 2.5 | Dual switch | `10.0.20.57` | `persiana-conills.local` | ~1 A (est., big shutter) | 0.5 A |
| **persiana-habitacio-sud** | Shelly 2.5 | Dual switch | `10.0.20.58` | `persiana-habitacio-sud.local` | ~1 A (est., big shutter) | 0.5 A |

**Shared/global topic** — not device-specific: `halt_automations` (payload `ON`/`OFF`) pauses automations on every device that includes `packages/halt-automations.yaml` (currently: `llum-cuina`, `llum-ambient-dormitori`, `llum-ventilador-menjador`, `persiana-marc-nord`, `persiana-marc-piscina`). Publishing to it affects **all** of those devices at once, since the topic has no per-device prefix.

**Note on llum-cuina**: it also *listens* to an external topic, `zigbee2mqtt/laia-marc-porta-garatge-contact-sensor`, to trigger a nighttime effect when the garage door opens — this isn't a direct action on the device, just an automation input.

## 🛠️ Useful Commands

```bash
# Check config 🔍
esphome config devices/your-device.yaml

# Flash via USB 🔌
esphome run devices/your-device.yaml --device /dev/ttyUSB0

# View logs 👀
esphome logs devices/your-device.yaml --device OTA
```

## 🔌 Manual USB Flashing (macOS)

Some devices (e.g. Shelly boards with a broken/unknown OTA password, or a first-time flash) need to be flashed over a USB-to-serial adapter instead of OTA. Podman on macOS can't reach USB-serial devices (see note above), so this uses a native ESPHome install instead of the container.

### One-time setup

**1. Install Python 3.12.** ESPHome 2025.11.4 requires Python `>=3.11,<3.14`; macOS's default `python3` may resolve to a newer, unsupported version.

```bash
brew install python@3.12
```

**2. Create a venv in the repo and install ESPHome into it:**

```bash
/opt/homebrew/opt/python@3.12/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install esphome==2025.11.4
```

**3. Work around a PlatformIO/`uv` bug.** Internally, PlatformIO uses `uv` to build an ESP-IDF Python environment. If your Mac's unversioned `python3` (e.g. `/opt/homebrew/bin/python3`) resolves to a version newer than 3.13, `uv` may try to build `pydantic-core` from source against that version instead of the venv's Python — and fail, since PyO3 doesn't support unreleased Python versions yet. Fix by manually building that inner venv with plain `pip` (which just downloads prebuilt wheels) and marking it as valid so PlatformIO skips its own setup:

```bash
# .espidf-5.5.1 is named after the pinned ESP-IDF version — check the error
# message for the correct path if this doesn't match.
rm -rf ~/.platformio/penv/.espidf-5.5.1
/opt/homebrew/bin/python3.12 -m venv ~/.platformio/penv/.espidf-5.5.1
~/.platformio/penv/.espidf-5.5.1/bin/python -m pip install --upgrade pip
~/.platformio/penv/.espidf-5.5.1/bin/python -m pip install \
  "urllib3<2" "cryptography~=44.0.0" "pyparsing>=3.1.0,<4" \
  "pydantic~=2.11.10" "idf-component-manager~=2.2" "esp-idf-kconfig~=2.5.0" "chardet>=3.0.2,<4"

PYVER=$(~/.platformio/penv/.espidf-5.5.1/bin/python -c "import sys;print('{0}.{1}.{2}-{3}.{4}'.format(*list(sys.version_info)))")
cat > ~/.platformio/penv/.espidf-5.5.1/pio-idf-venv.json <<EOF
{"version": "1.0.0", "python_version": "$PYVER"}
EOF
```

**4. Decrypt secrets natively** (the container's `entrypoint.sh` does this automatically, but native runs need it done manually — see the age recipient in `.age-recipients`, derived from `~/.ssh/id_dev`):

```bash
age --decrypt --identity ~/.ssh/id_dev --output common/secrets.yaml secrets.enc.yaml
```

### Every time you flash

**5. Wire a USB-to-serial adapter to the device's UART header:** GND↔GND, adapter TX→board RX, adapter RX→board TX (crossed). Power the board from its normal supply, not the adapter.

**6. Enter bootloader mode** (most Shelly boards have no auto-reset circuitry, so this must be done manually):
- Bridge GPIO0 to GND and hold it there.
- Momentarily pulse RESET/EN to GND and release (a quick tap, not held) — this reboots the chip while GPIO0 is grounded, putting it into UART download mode.
- Keep GPIO0 grounded through the whole flash.

**7. Find the serial port:**

```bash
ls /dev/cu.*   # look for /dev/cu.usbserial-*
```

**8. Flash:**

```bash
source .venv/bin/activate
esphome run devices/your-device.yaml --device /dev/cu.usbserial-10 --upload_speed 115200 --no-logs
```

`--upload_speed 115200` avoids write instability some adapters hit at the default 460800 baud.

**9. Power-cycle after a successful flash.** `esptool`'s `Hard resetting via RTS pin` doesn't actually reset boards with no auto-reset circuit — the chip stays in the bootloader stub. After `Successfully uploaded program.`, don't re-run the flash command; instead unbridge GPIO0 and fully power-cycle the board (unplug/replug its mains supply) so it boots the new firmware.

## 🎯 Pro Tips

- 💡 Use `esphome config` to validate befhostnameore flashing
- 🔄 OTA updates save climbing ladders!
- 📊 Web interface at `http://device-name.local`

---

*Happy automating! 🏠✨*
