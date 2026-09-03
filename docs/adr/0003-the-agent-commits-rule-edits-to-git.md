# The agent commits rule edits to git

Editing shutter rules by conversation is a required capability: Marc tells
the agent "open the kitchen shutter 15 minutes after sunrise" and the rule
changes. That collides with shipping `shutter_rules.yaml` inside the
`home-agent` image, where a runtime edit survives only until the next
deploy overwrites it — a change that looks applied but silently reverts.

`home-agent` therefore keeps a git clone as its working copy, and a rule
edit is a commit pushed to `main`. The repository stays the source of truth,
conversational edits are durable and auditable, and the planner reloads the
file on each run so an edit takes effect at the next planner run without a
restart.

## Consequences

The container needs a deploy key with write access, and rule tweaks appear
in `my-esphome` history alongside firmware changes. The commit guard is
narrow by design: the agent may write `agent/skills/shutter-manager/shutter_rules.yaml`
and nothing else, so no conversation can ever modify device firmware.

Because a rule change ends in mains-wired motors moving unattended, the edit
is validated before it is committed — known triggers, known device names,
well-formed times, bounded offsets — and the resulting diff is echoed back
over Telegram. A malformed file is rejected with a reason rather than
committed. This is a trust boundary between a language model and hardware,
and is deliberately not simplified away.

The rejected alternative was keeping rules on a persistent volume with the
repository copy as reference only. It reproduces the drift that already left
the live rules and the committed ones disagreeing for seven weeks.
