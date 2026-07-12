#!/opt/data/home-automation/venv/bin/python
"""
Daily Shutter Scheduler

Runs at 01:30 every day. Reads shutter_rules.yaml, calculates solar times,
and creates one-shot cron jobs for each time slot — writing directly to
jobs.json so past-time jobs are not rejected by the 120s grace window.

The scheduler will fire past-time one-shots on the next tick (catchup),
but since the planner runs at 01:30 (before sunrise), all solar-based
times will be in the future.
"""
import yaml
import json
import re
import uuid
import os
import fcntl
from datetime import datetime, timedelta, timezone
from astral.location import LocationInfo
from astral import sun

# --- Configuration ---
HERMES_EXEC = "/opt/hermes/bin/hermes"
LOCATION_NAME = "Cardona"
LOCATION_REGION = "Spain"
LOCATION_LAT = 41.9137
LOCATION_LON = 1.6786
RULES_FILE = "/opt/data/home-automation/shutter_rules.yaml"
SHUTTER_SCRIPT_PATH = "/opt/data/skills/home-automation/home-shutters/scripts/shutters.py"
SCHEDULE_TAG = "AUTOSHUTTER-ONESHOT"
HERMES_HOME = os.environ.get("HERMES_HOME", os.path.expanduser("~"))
SCRIPTS_DIR = os.path.join(HERMES_HOME, "scripts")
JOBS_FILE = "/opt/data/cron/jobs.json"
LOCK_FILE = "/opt/data/cron/jobs.json.lock"


def acquire_lock():
    """Acquire an exclusive file lock on jobs.json to prevent concurrent writes."""
    os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
    lock_fd = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        return lock_fd
    except (IOError, OSError) as e:
        print(f"FATAL: Could not acquire lock on {LOCK_FILE}: {e}")
        lock_fd.close()
        return None


def release_lock(lock_fd):
    """Release the file lock."""
    if lock_fd:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


def get_season(d):
    """Determines the season in the Northern hemisphere for a given date."""
    if 3 <= d.month <= 5: return "spring"
    if 6 <= d.month <= 8: return "summer"
    if 9 <= d.month <= 11: return "autumn"
    return "winter"


def load_jobs():
    """Load the current jobs.json, returning (dict, raw_jobs_list)."""
    try:
        with open(JOBS_FILE, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"ERROR: Could not read {JOBS_FILE}: {e}")
        return None, None
    raw_jobs = data.get("jobs", [])
    return data, raw_jobs


def save_jobs(data):
    """Write jobs.json back to disk."""
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    tmp_path = JOBS_FILE + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(data, f, indent=2, default=str)
    os.replace(tmp_path, JOBS_FILE)


def cleanup_old_jobs_and_scripts(raw_jobs):
    """Removes AUTOSHUTTER jobs from raw_jobs list and deletes their scripts."""
    print("--- Cleaning up old jobs and scripts ---")

    kept_jobs = []
    removed_count = 0
    scripts_to_remove = set()

    for job in raw_jobs:
        if isinstance(job, dict):
            name = job.get("name", "")
            if name.startswith(SCHEDULE_TAG):
                removed_count += 1
                script = job.get("script")
                if script:
                    scripts_to_remove.add(script)
                continue
        kept_jobs.append(job)

    # Remove old script files
    for script_name in scripts_to_remove:
        script_path = os.path.join(SCRIPTS_DIR, script_name)
        if os.path.exists(script_path):
            try:
                os.remove(script_path)
                print(f"Removed old script: {script_path}")
            except OSError as e:
                print(f"Error removing script {script_path}: {e}")

    print(f"Removed {removed_count} old AUTOSHUTTER job(s). Cleanup complete.")
    return kept_jobs


def schedule_new_jobs(raw_jobs):
    """Calculates solar times, builds action list, creates scripts and inserts jobs directly into jobs.json."""
    print("\n--- Calculating and scheduling new jobs ---")

    try:
        with open(RULES_FILE, "r") as f:
            rules = yaml.safe_load(f)
    except Exception as e:
        print(f"FATAL: Could not read or parse rules file {RULES_FILE}: {e}")
        return raw_jobs

    loc = LocationInfo(LOCATION_NAME, LOCATION_REGION, "UTC", LOCATION_LAT, LOCATION_LON)
    today = datetime.now(timezone.utc).date()
    solar_times_utc = sun.sun(loc.observer, date=today, tzinfo=timezone.utc)
    local_tz = datetime.now().astimezone().tzinfo
    solar_times_local = {key: value.astimezone(local_tz) for key, value in solar_times_utc.items()}

    print(f"Today's solar times for {LOCATION_NAME} (local time):")
    for event, time in solar_times_local.items():
        if event in ["sunrise", "sunset", "noon"]:
            print(f"  {event.capitalize()}: {time.strftime('%H:%M:%S')}")

    season = get_season(today)
    print(f"Current season: {season}")

    season_rules = rules.get(season)
    if not season_rules:
        print(f"No rules found for season '{season}'. No jobs to schedule.")
        return raw_jobs

    # Flatten rules into a list of (schedule_time, device, action) tuples
    raw_actions = []
    print("Processing rules...")
    for group in season_rules:
        entities = group.get("entities", [])
        if not entities:
            print(f"Skipping rule group '{group.get('name')}' because it has no entities.")
            continue

        for action_type in ["open", "close"]:
            if action_type in group:
                action_rule = group[action_type]
                trigger_type = action_rule.get("trigger")

                if trigger_type == "time":
                    time_str = action_rule.get("time")
                    if not time_str:
                        print(f"Skipping time-based action in '{group.get('name')}' due to missing 'time'.")
                        continue
                    try:
                        hour, minute = map(int, time_str.split(":"))
                        now = datetime.now(local_tz)
                        schedule_time = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    except (ValueError, TypeError) as e:
                        print(f"Skipping rule due to invalid time format '{time_str}': {e}")
                        continue
                elif trigger_type:
                    event_name = "noon" if trigger_type == "solar_zenith" else trigger_type
                    offset = action_rule.get("offset", 0)
                    base_time = solar_times_local.get(event_name)
                    if not base_time:
                        print(f"Skipping rule due to unknown solar event: {event_name}")
                        continue
                    schedule_time = base_time + timedelta(minutes=offset)
                else:
                    continue

                device_list = ["all"] if "all" in entities else entities
                for device in device_list:
                    raw_actions.append((schedule_time, device, action_type))

    if not raw_actions:
        print("Rule processing resulted in no actions to schedule.")
        return raw_jobs

    # Group actions by time slot (same minute)
    time_slots = {}
    for schedule_time, device, action in raw_actions:
        time_key = schedule_time.strftime("%H%M")
        if time_key not in time_slots:
            time_slots[time_key] = {"schedule_time": schedule_time, "pairs": []}
        time_slots[time_key]["pairs"].append(f"{device}:{action}")

    # Create one script and one cron job per time slot
    new_jobs = []
    for time_key, slot in sorted(time_slots.items()):
        schedule_time = slot["schedule_time"]
        schedule_time_iso = schedule_time.isoformat()
        pairs_str = " ".join(slot["pairs"])
        job_name = f"{SCHEDULE_TAG}_{time_key}"
        script_name = f"autoshutter_{time_key}.sh"
        script_path = os.path.join(SCRIPTS_DIR, script_name)

        command_to_run = f"/opt/data/home-automation/venv/bin/python {SHUTTER_SCRIPT_PATH} control-multi {pairs_str}"
        script_content = f"#!/bin/bash\n# One-shot for {job_name}\n{command_to_run}\n"

        try:
            with open(script_path, "w") as f:
                f.write(script_content)
            os.chmod(script_path, 0o755)
        except OSError as e:
            print(f"FATAL: Could not write script {script_path}: {e}")
            continue

        print(f"Scheduling job '{job_name}' at {schedule_time.strftime('%Y-%m-%d %H:%M:%S')} for {len(slot['pairs'])} shutter(s): {pairs_str}")

        # Build job dict in the same format as hermes cron create
        job_id = uuid.uuid4().hex[:12]
        job = {
            "id": job_id,
            "name": job_name,
            "prompt": "",
            "skills": [],
            "skill": None,
            "model": None,
            "provider": None,
            "provider_snapshot": None,
            "model_snapshot": None,
            "base_url": None,
            "script": script_name,
            "no_agent": True,
            "context_from": None,
            "schedule": {
                "kind": "oneshot",
                "run_at": schedule_time_iso,
            },
            "schedule_display": f"once at {schedule_time.strftime('%Y-%m-%d %H:%M')}",
            "repeat": {"times": 1, "completed": 0},
            "enabled": True,
            "state": "scheduled",
            "paused_at": None,
            "paused_reason": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "next_run_at": schedule_time_iso,
            "last_run_at": None,
            "last_status": None,
            "last_error": None,
            "last_delivery_error": None,
            "deliver": "local",
            "origin": None,
            "enabled_toolsets": None,
            "workdir": None,
            "fire_claim": None,
        }
        new_jobs.append(job)

    print(f"Created {len(new_jobs)} job(s) across {len(time_slots)} time slot(s).")
    return raw_jobs + new_jobs


def main():
    print("--- Dynamic Shutter Scheduler ---")
    print(f"Run started at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Acquire lock to prevent concurrent jobs.json access
    lock_fd = acquire_lock()
    if not lock_fd:
        print("FATAL: Could not acquire lock. Aborting.")
        return

    try:
        # Load current jobs
        data, raw_jobs = load_jobs()
        if data is None:
            print("FATAL: Could not load jobs.json. Aborting.")
            return

        # Clean up old AUTOSHUTTER jobs
        kept_jobs = cleanup_old_jobs_and_scripts(raw_jobs)

        # Schedule new jobs (returns kept_jobs + new_jobs)
        all_jobs = schedule_new_jobs(kept_jobs)

        # Save back to jobs.json
        data["jobs"] = all_jobs
        save_jobs(data)
        print(f"\nWrote {len(all_jobs)} total jobs to {JOBS_FILE}")
    finally:
        release_lock(lock_fd)

    print("Run finished.")


if __name__ == "__main__":
    main()
