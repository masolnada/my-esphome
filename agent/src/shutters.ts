import { connectAsync, type MqttClient } from "mqtt";
import { DEVICES, type Device } from "./rules.js";

export type ShutterAction = "OPEN" | "CLOSE" | "STOP" | `${number}`;
export interface ShutterCommand { device: Device; action: ShutterAction }

export class Shutters {
  constructor(
    private readonly url: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  async control(commands: ShutterCommand[]): Promise<string> {
    if (!commands.length) throw new Error("at least one shutter command is required");
    for (const command of commands) validateCommand(command);
    const client = await this.connect();
    try {
      await Promise.all(commands.map(({ device, action }) => {
        const { topic, payload } = mqttCommand(device, action);
        return client.publishAsync(topic, payload, { qos: 1 });
      }));
    } finally {
      await client.endAsync();
    }
    return commands.map(({ device, action }) => `${device}: ${action}`).join("\n");
  }

  async status(device: Device): Promise<string> {
    if (!DEVICES.includes(device)) throw new Error(`unknown shutter: ${device}`);
    const client = await this.connect();
    const values = new Map<string, string>();
    try {
      await client.subscribeAsync(`${device}/cover/blind/#`, { qos: 0 });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        client.on("message", (topic, payload) => {
          values.set(topic, payload.toString());
          if (values.size >= 2) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    } finally {
      await client.endAsync();
    }
    if (!values.size) return `${device}: no retained status received`;
    return [...values.entries()].map(([topic, value]) => `${topic}: ${value}`).join("\n");
  }

  private connect(): Promise<MqttClient> {
    return connectAsync(this.url, {
      username: this.username,
      password: this.password,
      reconnectPeriod: 0,
      connectTimeout: 5_000,
      clean: true,
    });
  }
}

export function mqttCommand(device: Device, action: ShutterAction): { topic: string; payload: string } {
  validateCommand({ device, action });
  const numeric = /^\d+$/.test(action);
  return numeric
    ? { topic: `${device}/cover/blind/position/command`, payload: action }
    : { topic: `${device}/cover/blind/command`, payload: action.toUpperCase() };
}

function validateCommand(command: ShutterCommand): void {
  if (!DEVICES.includes(command.device)) throw new Error(`unknown shutter: ${command.device}`);
  if (/^\d+$/.test(command.action)) {
    const position = Number(command.action);
    if (position >= 0 && position <= 100) return;
  }
  if (["OPEN", "CLOSE", "STOP"].includes(command.action.toUpperCase())) return;
  throw new Error(`invalid shutter action: ${command.action}`);
}
