# Home Agent

Standalone pi agent and deterministic shutter scheduler for the Cardona house.
It talks to Marc through a dedicated Telegram bot, reads and commits
`shutter_rules.yaml`, and publishes shutter commands to Mosquitto.

## Commands

- `/shutter-band` — show today's band and remaining slots
- `/shutter-band hot|mild|cold` — override today and re-plan future slots
- `/shutter_band ...` — Telegram-menu-compatible alias
- `/status` — show today's plan
- Any other message goes to the pi agent for shutter control or conversational
  rule editing.

## Local checks

```bash
npm install
npm test
npm run typecheck
```

## Runtime

The container clones `my-esphome` into `/data/repo`. Conversational rule edits
are validated, committed, and pushed directly to `main`; a path guard allows
only `agent/skills/shutter-manager/shutter_rules.yaml`.

Persistent volumes hold the git clone, pi state and sessions, forecast cache,
today's override, and fired slot IDs. The bot uses an independent Telegram
token and must not share Hermes' token.
