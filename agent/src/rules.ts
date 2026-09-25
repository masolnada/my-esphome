import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export const BANDS = ["hot", "mild", "cold"] as const;
export type Band = (typeof BANDS)[number];
export const TRIGGERS = ["sunrise", "sunset", "solar_zenith", "time"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const DEVICES = [
  "persiana-cuina-sud",
  "persiana-cuina-pica",
  "persiana-menjador",
  "persiana-marc-piscina",
  "persiana-marc-nord",
  "persiana-dormitori",
  "persiana-bany",
  "persiana-conills",
  "persiana-habitacio-sud",
] as const;
export type Device = (typeof DEVICES)[number];

export interface ActionRule {
  trigger: Trigger;
  offset: number;
  time?: string;
  position?: number;
  duration?: number;
  steps?: number;
}

export interface RuleGroup {
  name: string;
  entities: Array<Device | "all">;
  open?: ActionRule;
  close?: ActionRule;
}

export interface ShutterRules {
  thresholds: { hotAbove: number; coldBelow: number };
  hot: RuleGroup[];
  mild: RuleGroup[];
  cold: RuleGroup[];
}

export async function loadRules(path: string): Promise<ShutterRules> {
  return parseRules(await readFile(path, "utf8"));
}

export function parseRules(content: string): ShutterRules {
  let value: unknown;
  try {
    value = parse(content);
  } catch (error) {
    throw new Error(`invalid YAML: ${message(error)}`);
  }
  const root = object(value, "rules");
  exactKeys(root, ["thresholds", ...BANDS], "rules");
  const thresholds = object(root.thresholds, "thresholds");
  exactKeys(thresholds, ["hot_above", "cold_below"], "thresholds");
  const hotAbove = finiteNumber(thresholds.hot_above, "thresholds.hot_above");
  const coldBelow = finiteNumber(thresholds.cold_below, "thresholds.cold_below");
  if (coldBelow >= hotAbove) throw new Error("thresholds.cold_below must be below thresholds.hot_above");

  return {
    thresholds: { hotAbove, coldBelow },
    hot: parseBand(root.hot, "hot"),
    mild: parseBand(root.mild, "mild"),
    cold: parseBand(root.cold, "cold"),
  };
}

export function bandForTemperature(temperature: number, rules: ShutterRules): Band {
  if (temperature > rules.thresholds.hotAbove) return "hot";
  if (temperature < rules.thresholds.coldBelow) return "cold";
  return "mild";
}

export function isBand(value: string): value is Band {
  return BANDS.includes(value as Band);
}

function parseBand(value: unknown, band: Band): RuleGroup[] {
  if (!Array.isArray(value)) throw new Error(`${band} must be a list`);
  return value.map((entry, index) => parseGroup(entry, `${band}[${index}]`));
}

function parseGroup(value: unknown, path: string): RuleGroup {
  const group = object(value, path);
  exactKeys(group, ["name", "entities", "open", "close"], path);
  if (typeof group.name !== "string" || !group.name.trim()) throw new Error(`${path}.name must be a non-empty string`);
  if (!Array.isArray(group.entities) || group.entities.length === 0) throw new Error(`${path}.entities must be a non-empty list`);
  const entities = group.entities.map((entity, index) => {
    if (entity === "all" || (typeof entity === "string" && DEVICES.includes(entity as Device))) return entity as Device | "all";
    throw new Error(`${path}.entities[${index}] is not a known shutter`);
  });
  if (entities.includes("all") && entities.length !== 1) throw new Error(`${path}.entities cannot combine all with named shutters`);
  const result: RuleGroup = { name: group.name, entities };
  if (group.open !== undefined) result.open = parseAction(group.open, `${path}.open`, 0, 100);
  if (group.close !== undefined) result.close = parseAction(group.close, `${path}.close`, 100, 0);
  if (!result.open && !result.close) throw new Error(`${path} must define open or close`);
  return result;
}

function parseAction(value: unknown, path: string, start: number, defaultPosition: number): ActionRule {
  const action = object(value, path);
  exactKeys(action, ["trigger", "offset", "time", "position", "duration", "steps"], path);
  if (typeof action.trigger !== "string" || !TRIGGERS.includes(action.trigger as Trigger)) {
    throw new Error(`${path}.trigger must be one of ${TRIGGERS.join(", ")}`);
  }
  const trigger = action.trigger as Trigger;
  const offset = action.offset === undefined ? 0 : integer(action.offset, `${path}.offset`);
  if (Math.abs(offset) > 180) throw new Error(`${path}.offset must be between -180 and 180 minutes`);
  if (trigger === "time") {
    if (typeof action.time !== "string" || !validTime(action.time)) throw new Error(`${path}.time must be HH:MM`);
  } else if (action.time !== undefined) {
    throw new Error(`${path}.time is only valid with trigger: time`);
  }

  const position = action.position === undefined ? undefined : integer(action.position, `${path}.position`);
  if (position !== undefined && (position < 0 || position > 100)) throw new Error(`${path}.position must be between 0 and 100`);
  if ((action.duration === undefined) !== (action.steps === undefined)) throw new Error(`${path}.duration and ${path}.steps must be used together`);
  const duration = action.duration === undefined ? undefined : integer(action.duration, `${path}.duration`);
  const steps = action.steps === undefined ? undefined : integer(action.steps, `${path}.steps`);
  if (duration !== undefined && duration <= 0) throw new Error(`${path}.duration must be positive`);
  if (steps !== undefined && steps < 2) throw new Error(`${path}.steps must be at least 2`);
  if (duration !== undefined && steps !== undefined && duration % steps !== 0) throw new Error(`${path}.duration must be divisible by ${path}.steps`);
  if (steps !== undefined && steps > Math.abs((position ?? defaultPosition) - start)) {
    throw new Error(`${path}.steps would produce duplicate positions`);
  }
  return {
    trigger,
    offset,
    ...(typeof action.time === "string" ? { time: action.time } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(duration !== undefined ? { duration, steps: steps! } : {}),
  };
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`${path} has unknown keys: ${extra.join(", ")}`);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a number`);
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${path} must be an integer`);
  return value;
}

function validTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
