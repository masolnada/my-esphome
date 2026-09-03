# Shutter slots are in-process timers, not a durable job queue

The previous planner could not schedule anything itself. It wrote hand-built
job records into the Hermes scheduler's `jobs.json` and let that scheduler
fire them. Every scheduling incident lived in that seam: legitimate jobs
rejected by a 120-second grace window (12-07-2026); every solar job firing at
once at 01:31 when catch-up ran against a past-dated plan (13-07-2026); an
`fcntl` lock needed because two processes wrote the same file; a 30-field job
dict copied from the scheduler's internals.

`home-agent` owns its own process, so the day's time slots are held as
in-process timers. `jobs.json`, the grace window, catch-up and the lock are
all deleted.

## Consequences

The 13-07 incident is now structurally impossible: a timer for a past moment
is never armed, so "skip elapsed slots" stops being a guard someone must
remember and becomes the only thing the code can do. A slot that has already
passed is lost for the day — including after a manual band override, which
therefore delivers less the later it is used.

Timers do not survive the process. The day is re-planned on startup, which
covers restarts and deploys. A fired-slots file records which slots have
already executed, so a re-plan after a crash does not repeat movements a
shutter has already made.

The rejected alternative was porting the durable queue as-is. It was
rejected because its durability was never the point — it existed only
because the planner had to hand work to a scheduler it did not control.
