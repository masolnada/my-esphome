# Shutter Automation Cron Investigation — 2026-07-12

## Problem

Early-morning AUTOSHUTTER one-shot jobs are not being created. Specifically:

- `AUTOSHUTTER-ONESHOT_0559` (sunrise−30min, Group 3c open — `persiana-cuina-sud` + `persiana-habitacio-sud`)
- `AUTOSHUTTER-ONESHOT_0659` (sunrise+30min, Group 2 close — `persiana-cuina-pica`)

Both are rejected by the cron scheduler with:

> `Rejecting one-shot cron job 'AUTOSHUTTER-ONESHOT_0559': run_at 2026-07-12T05:59:05 is outside the 120s grace window`

## Root Cause: The 2AM Planner Run Is Not Firing

The **Dynamic Shutter Planner** (job ID: `d57a3f5ddee9`, schedule `0 2 * * *`) is supposed to run at 2AM and create all the day's one-shot jobs while every time slot is still in the future. It is not firing at 2AM.

### Evidence

1. **`last_run_at` is 07:05 today, not ~02:00.** If the 2AM run had fired, this would show a timestamp around 02:00. The 07:05 timestamp appears to be a catchup run (the scheduler's "execute once now even if past grace" behavior).

2. **Same pattern on July 11.** An AUTOSHUTTER rejection at 08:00 for a job scheduled at 06:58 confirms the planner ran at ~08:00 that day, not 2AM.

3. **The Memory Backup (`0 1 * * *`) DOES run at 1AM.** Git log confirms a commit at `2026-07-11T23:00:46Z` (= 01:00 CEST July 12). The scheduler is operational overnight, but the planner at 2AM specifically isn't firing.

4. **No "missed its scheduled time" log entry.** The scheduler doesn't log that it missed the 2AM window. It silently produces a catchup run hours later.

5. **No event loop stalls or errors between 1AM and 7AM.** The gateway was healthy and running (restarted at 21:35 on July 11, no issues until 06:58 today).

6. **No AUTOSHUTTER job has ever been run by the scheduler.** Searching `agent.log` for `AUTOSHUTTER` + `cron.scheduler` returns zero matches. The only scheduler-run no_agent jobs were the old-style one-script-per-device jobs on July 9 (which produced empty stdout and logged as "silent run").

7. **Planner `completed` count: 9** since creation on July 8. These are catchup runs, not 2AM runs.

## What IS Working

- ✅ The scheduler runs the **Memory Backup at 1AM** (git commit confirmed)
- ✅ The scheduler runs the **Nightly Seed Reminder at 9PM** (delivered to Telegram)
- ✅ The planner **does run eventually** (as a catchup at 7–8 AM) and creates jobs for all times still in the future
- ✅ **7 of 9 AUTOSHUTTER jobs** were created successfully for today (10:00, 12:58, 13:58, 14:58, 17:00, 20:58, 21:28)
- ✅ The planner's `next_run_at` is correctly set to `2026-07-13T02:00:00+02:00`

## What's NOT Working

- ❌ The **2AM planner run is not firing** — cause unknown
- ❌ As a result, **early-morning jobs (before ~7AM) never get created** because by the time the catchup runs, they're past the 120s grace window
- ❌ Affected jobs: sunrise−30min open (~05:59) and sunrise+30min close (~06:59)
- ❌ The new Group 3c rule (open `persiana-cuina-sud` + `persiana-habitacio-sud` at sunrise−30min) will not fire until this is resolved

## Timeline of Planner Runs (from logs)

| Date       | Expected 2AM | Actual Run  | Evidence                              |
|------------|-------------|-------------|---------------------------------------|
| 2026-07-09 | 02:00       | ~14:27      | planner.log entry                     |
| 2026-07-10 | 02:00       | ~06:17+     | agent.log: blocked symlink error      |
| 2026-07-11 | 02:00       | ~08:00      | AUTOSHUTTER rejection at 08:00        |
| 2026-07-12 | 02:00       | ~07:05      | AUTOSHUTTER rejection at 07:05        |

## Log Sources Checked

- `/opt/data/logs/agent.log` — cron.scheduler entries, cron.jobs rejections
- `/opt/data/logs/errors.log` — event loop stalls, cron rejections
- `/opt/data/logs/gateways/default/current` — gateway startup events
- `/opt/data/logs/container-boot.log` — container restart history
- `/opt/data/home-automation/planner.log` — stale (last entry July 9, wrapper no longer redirects here)
- `/opt/data/cron/jobs.json` — planner job state: `completed: 9`, `last_run_at: 2026-07-12T07:05:17`

## Possible Causes (Not Yet Confirmed)

1. **Scheduler conflict with Memory Backup at 1AM** — The backup job runs at 1AM and takes some time. If it holds a lock or blocks the scheduler loop, the 2AM tick could be missed.
2. **Scheduler grace/catchup logic bug** — The planner has `completed: 9` runs, but none at 2AM. The scheduler may be miscalculating the next_run_at or skipping the job silently.
3. **no_agent job execution issue** — The planner is a no_agent script job. There may be a code path where no_agent jobs with deliver=local are skipped during the overnight tick.

## Recommended Actions

1. **Move the planner schedule to 1:30 AM** (`30 1 * * *`) to avoid any potential conflict with the 1AM Memory Backup job.
2. **Or move it to 0:00** (`0 0 * * *`) for maximum margin before sunrise.
3. **Verify tomorrow morning** by checking `last_run_at` early — if it shows ~01:30 or ~00:00, the issue is schedule-timing-related.
4. **Add logging to the wrapper script** — redirect planner output to `planner.log` so overnight runs are captured:
   ```bash
   exec /opt/data/home-automation/run_shutter_planner.sh "$@" 2>&1 | tee -a /opt/data/home-automation/planner.log
   ```
5. **Consider adding a `hermes cron tick` cron job** at 2:05AM as a safety net to ensure the scheduler evaluates the planner.

## Files Modified During This Session

- `/opt/data/home-automation/shutter_rules.yaml` — Added Group 3c (sunrise−30min open for `persiana-cuina-sud` + `persiana-habitacio-sud`)
- Pushed to git backup at `github.com/masolnada/my-esphome`
