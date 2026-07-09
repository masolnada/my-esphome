import argparse
import yaml
import paho.mqtt.client as mqtt
import time
import os
import threading

DEVICES = {
    "persiana-cuina-sud": {"ip": "10.0.20.50", "hardware": "Shelly 2.5", "open_time": 12, "close_time": 10},
    "persiana-cuina-pica": {"ip": "10.0.20.51", "hardware": "Shelly 2.5", "open_time": 12, "close_time": 10},
    "persiana-menjador": {"ip": "10.0.20.52", "hardware": "Shelly 2.5", "open_time": 12, "close_time": 10},
    "persiana-marc-piscina": {"ip": "10.0.20.53", "hardware": "Shelly Plus 2", "open_time": 17, "close_time": 17},
    "persiana-marc-nord": {"ip": "10.0.20.54", "hardware": "Shelly Plus 2", "open_time": 17, "close_time": 16.5},
    "persiana-dormitori": {"ip": "10.0.20.55", "hardware": "Shelly 2.5", "open_time": 12, "close_time": 10},
    "persiana-bany": {"ip": "10.0.20.56", "hardware": "Shelly 2.5", "open_time": 12, "close_time": 10},
    "persiana-conills": {"ip": "10.0.20.57", "hardware": "Shelly 2.5", "open_time": 12, "close_time": 10},
    "persiana-habitacio-sud": {"ip": "10.0.20.58", "hardware": "Shelly 2.5", "open_time": 12, "close_time": 10},
}

def get_secrets():
    """Reads MQTT secrets from /opt/data/home-automation/secrets.yaml."""
    secrets_path = "/opt/data/home-automation/secrets.yaml"
    try:
        with open(secrets_path, 'r') as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        print(f"Error: Secrets file not found at {secrets_path}")
        print("Please create it with mqtt_broker_address, mqtt_broker_username, and mqtt_broker_password.")
        return None
    except Exception as e:
        print(f"Error reading secrets file: {e}")
        return None

def build_command(device, command):
    """Returns (topic, payload) for a device command, or None on error."""
    if command.isdigit():
        position = int(command)
        if 0 <= position <= 100:
            topic = f"{device}/cover/blind/position/command"
            payload = str(position)
        else:
            print(f"Invalid position: {command}. Must be between 0 and 100.")
            return None
    else:
        command = command.upper()
        if command not in ["OPEN", "CLOSE", "STOP"]:
            print(f"Invalid command: {command}. Must be OPEN, CLOSE, or STOP.")
            return None
        topic = f"{device}/cover/blind/command"
        payload = command
    return (topic, payload)

def control_shutter(client, device, command):
    """Sends a command to a specific shutter via an existing MQTT client."""
    result = build_command(device, command)
    if result is None:
        return
    topic, payload = result
    client.publish(topic, payload)
    print(f"Sent command '{payload}' to device '{device}' on topic '{topic}'")

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        client.subscribe(userdata['topic'])
    else:
        print(f"Failed to connect, return code {rc}")
        userdata['connect_failed'] = True

def on_message(client, userdata, msg):
    userdata['messages'].append(msg.payload.decode())
    if len(userdata['messages']) >= 2:  # state and position
        client.disconnect()

def on_publish(client, userdata, mid, reasonCode=None, properties=None):
    """Track published message count for QoS-1 confirmation."""
    userdata['published'] = userdata.get('published', 0) + 1

def get_status(device, secrets):
    """Gets the status of a specific shutter."""
    topic = f"{device}/cover/blind/#"
    userdata = {'topic': topic, 'messages': []}

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, userdata=userdata)
    client.username_pw_set(secrets["mqtt_broker_username"], secrets["mqtt_broker_password"])

    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(secrets["mqtt_broker_address"], 1883, 60)
        client.loop_start()
        # Wait for messages or timeout
        timeout = time.time() + 5
        while not userdata.get('messages') and time.time() < timeout:
            time.sleep(0.1)
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        client.loop_stop()
        client.disconnect()

    if not userdata['messages']:
        print(f"Could not retrieve status for {device}. Is it online?")
    else:
        print(f"Status for {device}:")
        for message in userdata['messages']:
             print(message)


def main():
    parser = argparse.ArgumentParser(description="Control home shutters via MQTT.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # List command
    subparsers.add_parser("list", help="List all available shutters.")

    # Control command (single device or 'all')
    parser_control = subparsers.add_parser("control", help="Control a single shutter (or all).")
    parser_control.add_argument("device", help="The device name (e.g., persiana-dormitori) or 'all'.")
    parser_control.add_argument("action", help="The action to perform (OPEN, CLOSE, STOP, or a position 0-100).")

    # Control-multi command (multiple device:action pairs in one MQTT connection)
    parser_multi = subparsers.add_parser("control-multi", help="Control multiple shutters simultaneously with a single MQTT connection.")
    parser_multi.add_argument("pairs", nargs="+", help="Device:action pairs, e.g. persiana-menjador:close persiana-bany:open")

    # Status command
    parser_status = subparsers.add_parser("status", help="Get the status of a shutter.")
    parser_status.add_argument("device", help="The device name (e.g., persiana-dormitori).")

    args = parser.parse_args()

    if args.command == "list":
        print("Available shutters:")
        for device in DEVICES:
            print(f"- {device}")
        return

    secrets = get_secrets()
    if not secrets:
        return

    # --- control-multi: one connection, all commands, wait for publish confirms ---
    if args.command == "control-multi":
        # Parse pairs
        commands = []
        for pair in args.pairs:
            if ':' not in pair:
                print(f"Invalid pair '{pair}'. Expected format device:action (e.g., persiana-bany:open).")
                return
            device, action = pair.rsplit(':', 1)
            if device not in DEVICES:
                print(f"Device '{device}' not found.")
                return
            result = build_command(device, action)
            if result is None:
                return
            commands.append((device, result[0], result[1]))

        if not commands:
            print("No valid commands to send.")
            return

        userdata = {'published': 0, 'expected': len(commands)}
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, userdata=userdata)
        client.username_pw_set(secrets["mqtt_broker_username"], secrets["mqtt_broker_password"])
        client.on_publish = on_publish

        try:
            client.connect(secrets["mqtt_broker_address"], 1883, 60)
        except Exception as e:
            print(f"Could not connect to MQTT broker: {e}")
            return

        client.loop_start()

        # Publish all commands immediately (truly simultaneous)
        for device, topic, payload in commands:
            client.publish(topic, payload, qos=1)
            print(f"Sent command '{payload}' to device '{device}' on topic '{topic}'")

        # Wait for all QoS-1 publish confirmations (or timeout)
        timeout = time.time() + 5
        while userdata['published'] < userdata['expected'] and time.time() < timeout:
            time.sleep(0.05)

        if userdata['published'] < userdata['expected']:
            print(f"Warning: only {userdata['published']}/{userdata['expected']} messages confirmed by broker.")

        client.loop_stop()
        client.disconnect()
        return

    # --- control (single or all) ---
    if args.command == "control":
        userdata = {}
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, userdata=userdata)
        client.username_pw_set(secrets["mqtt_broker_username"], secrets["mqtt_broker_password"])

        try:
            client.connect(secrets["mqtt_broker_address"], 1883, 60)
        except Exception as e:
            print(f"Could not connect to MQTT broker: {e}")
            return

        client.loop_start()

        if args.device == "all":
            for device in DEVICES:
                control_shutter(client, device, args.action)
        elif args.device in DEVICES:
            control_shutter(client, args.device, args.action)
        else:
            print(f"Device '{args.device}' not found.")

        # Give the client time to publish
        time.sleep(1)
        client.loop_stop()
        client.disconnect()
        return

    # --- status ---
    if args.command == "status":
        if args.device in DEVICES:
            get_status(args.device, secrets)
        else:
            print(f"Device '{args.device}' not found.")
        return


if __name__ == "__main__":
    main()
