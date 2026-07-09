#!/opt/data/home-automation/venv/bin/python
import yaml
import subprocess
import re
from datetime import datetime, timedelta, timezone
from astral.location import LocationInfo
from astral import sun
import os

# --- Configuration ---
HERMES_EXEC = "/opt/hermes/bin/hermes"
LOCATION_NAME = "Cardona"
LOCATION_REGION = "Spain"
LOCATION_LAT = 41.9137
LOCATION_LON = 1.6786
RULES_FILE = "/opt/data/home-automation/shutter_rules.yaml"
SHUTTER_SCRIPT_PATH = "/opt/data/skills/home-automation/home-shutters/scripts/shutters.py"
SCHEDULE_TAG = "AUTOSHUTTER-ONESHOT"
SCRIPTS_DIR = os.path.join(os.environ.get("HERMES_HOME", os.path.expanduser("~")), "scripts")

def run_command(command):
    """Executes a shell command and returns its output."""
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {command}\n--- STDERR ---\n{e.stderr.strip()}")
        return None

def get_season(d):
    """Determines the season in the Northern hemisphere for a given date."""
    if 3 <= d.month <= 5: return "spring"
    if 6 <= d.month <= 8: return "summer"
    if 9 <= d.month <= 11: return "autumn"
    return "winter"

def cleanup_old_jobs_and_scripts():
    """Removes cron jobs and scripts created by previous runs."""
    print("--- Cleaning up old jobs and scripts ---")

    list_command = f"{HERMES_EXEC} cron list"
    result = run_command(list_command)
    if not result:
        print("Could not query cron list or it's empty.")
        return

    job_ids_to_remove = []
    scripts_to_remove = set()
    job_id_re = re.compile(r"([0-9a-f]{12})\s+\[")
    name_re = re.compile(r"Name:\s+(" + re.escape(SCHEDULE_TAG) + r"_\S+)")

    lines = result.splitlines()
    for i, line in enumerate(lines):
        name_match = name_re.search(line)
        if not name_match:
            continue
        job_name = name_match.group(1)
        job_id = None
        for j in range(i, max(i - 5, -1), -1):
            id_match = job_id_re.search(lines[j])
            if id_match:
                job_id = id_match.group(1)
                break
        if not job_id:
            print(f"Could not find job ID for '{job_name}', skipping.")
            continue
        job_ids_to_remove.append(job_id)
        # Infer script name from job name
        # Old format: AUTOSHUTTER-ONESHOT_2129_close_persiana_menjador -> autoshutter_2129_close_persiana_menjador.sh
        # New format: AUTOSHUTTER-ONESHOT_2129 -> autoshutter_2129.sh
        script_base = job_name.replace(SCHEDULE_TAG + '_', 'autoshutter_')
        script_name = script_base + ".sh"
        scripts_to_remove.add(script_name)

    if job_ids_to_remove:
        print(f"Removing old jobs: {', '.join(job_ids_to_remove)}")
        for jid in job_ids_to_remove:
            run_command(f"{HERMES_EXEC} cron rm {jid}")

    for script_name in scripts_to_remove:
        script_path = os.path.join(SCRIPTS_DIR, script_name)
        if os.path.exists(script_path):
            try:
                os.remove(script_path)
                print(f"Removed old script: {script_path}")
            except OSError as e:
                print(f"Error removing script {script_path}: {e}")

    print(f"Removed {len(job_ids_to_remove)} old job(s). Cleanup complete.")

def schedule_new_jobs():
    """Calculates and schedules the new jobs for the day, grouped by time slot."""
    print("\n--- Calculating and scheduling new jobs ---")

    try:
        with open(RULES_FILE, 'r') as f:
            rules = yaml.safe_load(f)
    except Exception as e:
        print(f"FATAL: Could not read or parse rules file {RULES_FILE}: {e}")
        return

    loc = LocationInfo(LOCATION_NAME, LOCATION_REGION, "UTC", LOCATION_LAT, LOCATION_LON)
    today = datetime.now(timezone.utc).date()
    solar_times_utc = sun.sun(loc.observer, date=today, tzinfo=timezone.utc)
    local_tz = datetime.now().astimezone().tzinfo
    solar_times_local = {key: value.astimezone(local_tz) for key, value in solar_times_utc.items()}

    print(f"Today's solar times for {LOCATION_NAME} (local time):")
    for event, time in solar_times_local.items():
        if event in ['sunrise', 'sunset', 'noon']:
            print(f"  {event.capitalize()}: {time.strftime('%H:%M:%S')}")

    season = get_season(today)
    print(f"Current season: {season}")

    season_rules = rules.get(season)
    if not season_rules:
        print(f"No rules found for season '{season}'. No jobs to schedule.")
        return

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
                        hour, minute = map(int, time_str.split(':'))
                        now = datetime.now(local_tz)
                        schedule_time = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    except (ValueError, TypeError) as e:
                        print(f"Skipping rule due to invalid time format '{time_str}': {e}")
                        continue
                elif trigger_type:
                    event_name = 'noon' if trigger_type == 'solar_zenith' else trigger_type
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
        return

    # Group actions by time slot (same minute)
    time_slots = {}
    for schedule_time, device, action in raw_actions:
        time_key = schedule_time.strftime("%H%M")
        if time_key not in time_slots:
            time_slots[time_key] = {"schedule_time": schedule_time, "pairs": []}
        time_slots[time_key]["pairs"].append(f"{device}:{action}")

    # Create one script and one cron job per time slot
    jobs_scheduled = 0
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
            with open(script_path, 'w') as f:
                f.write(script_content)
            os.chmod(script_path, 0o755)
        except OSError as e:
            print(f"FATAL: Could not write script {script_path}: {e}")
            continue

        print(f"Scheduling job '{job_name}' at {schedule_time.strftime('%Y-%m-%d %H:%M:%S')} for {len(slot['pairs'])} shutter(s): {pairs_str}")
        create_cmd = f"{HERMES_EXEC} cron create '{schedule_time_iso}' --name '{job_name}' --script '{script_name}' --no-agent --repeat 1"
        run_command(create_cmd)
        jobs_scheduled += 1

    print(f"Successfully scheduled {jobs_scheduled} new job(s) across {len(time_slots)} time slot(s).")


def main():
    print(f"--- Dynamic Shutter Scheduler ---")
    print(f"Run started at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    cleanup_old_jobs_and_scripts()
    schedule_new_jobs()
    print("Run finished.")

if __name__ == "__main__":
    main()
