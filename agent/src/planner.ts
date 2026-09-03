import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { atomicWrite, type DayForecast, ForecastService, localDate } from "./forecast.js";
import { BANDS, DEVICES, bandForTemperature, loadRules, type Band, type Device, type RuleGroup, type ShutterRules, type Trigger } from "./rules.js";
import { Shutters, type ShutterCommand } from "./shutters.js";

interface OverrideState { date: string; band: Band }
interface FiredState { date: string; slots: string[] }
export interface PlannedSlot { id: string; time: Date; commands: ShutterCommand[] }
export interface PlannerStatus {
  date: string;
  maxTemperature: number;
  band: Band;
  source: "forecast" | "override";
  scheduled: string[];
  fired: string[];
}

export class Planner {
  private readonly overridePath: string;
  private readonly firedPath: string;
  private timers: NodeJS.Timeout[] = [];
  private midnightTimer: NodeJS.Timeout | undefined;
  private current?: PlannerStatus;
  private chain = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly rulesPath: string,
    private readonly forecast: ForecastService,
    private readonly shutters: Shutters,
    stateDir: string,
  ) {
    this.overridePath = resolve(stateDir, "band-override.json");
    this.firedPath = resolve(stateDir, "fired-slots.json");
  }

  async start(): Promise<void> {
    try {
      await this.replan();
    } finally {
      this.armMidnight();
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearSlotTimers();
    if (this.midnightTimer) clearTimeout(this.midnightTimer);
  }

  replan(): Promise<PlannerStatus> {
    return this.serial(() => this.plan());
  }

  setOverride(band: Band): Promise<PlannerStatus> {
    return this.serial(async () => {
      await atomicWrite(this.overridePath, JSON.stringify({ date: localDate(), band } satisfies OverrideState));
      return this.plan();
    });
  }

  status(): PlannerStatus | undefined {
    return this.current;
  }

  private async plan(): Promise<PlannerStatus> {
    this.clearSlotTimers();
    const rules = await loadRules(this.rulesPath);
    const forecast = await this.forecast.today();
    const override = await readJson<OverrideState>(this.overridePath);
    const source = override?.date === forecast.date && BANDS.includes(override.band) ? "override" : "forecast";
    const band = source === "override" ? override!.band : bandForTemperature(forecast.maxTemperature, rules);
    const firedState = await readJson<FiredState>(this.firedPath);
    const fired = firedState?.date === forecast.date ? new Set(firedState.slots) : new Set<string>();
    if (firedState?.date !== forecast.date) await this.saveFired(forecast.date, fired);

    const now = new Date();
    const slots = buildSlots(rules[band], forecast).filter((slot) => slot.time > now && !fired.has(slot.id));
    for (const slot of slots) {
      const timer = setTimeout(() => {
        void this.serial(() => this.fire(slot, forecast.date));
      }, slot.time.getTime() - now.getTime());
      this.timers.push(timer);
    }
    this.current = {
      date: forecast.date,
      maxTemperature: forecast.maxTemperature,
      band,
      source,
      scheduled: slots.map((slot) => `${clock(slot.time)} ${describe(slot.commands)}`),
      fired: [...fired].sort(),
    };
    console.log(`Planned ${slots.length} slot(s) for ${forecast.date}: ${band} (${source}, ${forecast.maxTemperature} °C)`);
    return this.current;
  }

  private async fire(slot: PlannedSlot, date: string): Promise<void> {
    const state = await readJson<FiredState>(this.firedPath);
    const fired = state?.date === date ? new Set(state.slots) : new Set<string>();
    if (fired.has(slot.id)) return;
    // Mark first: after an ambiguous crash, skipping a movement is safer than repeating it.
    fired.add(slot.id);
    await this.saveFired(date, fired);
    try {
      await this.shutters.control(slot.commands);
      console.log(`Fired ${slot.id}: ${describe(slot.commands)}`);
      if (this.current?.date === date) {
        this.current.fired = [...fired].sort();
        const line = `${clock(slot.time)} ${describe(slot.commands)}`;
        this.current.scheduled = this.current.scheduled.filter((scheduled) => scheduled !== line);
      }
    } catch (error) {
      fired.delete(slot.id);
      await this.saveFired(date, fired);
      console.error(`Slot ${slot.id} failed:`, error);
    }
  }

  private saveFired(date: string, slots: Set<string>): Promise<void> {
    return atomicWrite(this.firedPath, JSON.stringify({ date, slots: [...slots].sort() } satisfies FiredState));
  }

  private armMidnight(): void {
    if (this.stopped) return;
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    this.midnightTimer = setTimeout(async () => {
      try {
        await this.replan();
      } catch (error) {
        console.error("Midnight planning failed:", error);
      } finally {
        this.armMidnight();
      }
    }, next.getTime() - now.getTime());
  }

  private clearSlotTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.chain.then(action, action);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function buildSlots(groups: RuleGroup[], forecast: DayForecast): PlannedSlot[] {
  const byMinute = new Map<string, PlannedSlot>();
  for (const group of groups) {
    for (const action of ["open", "close"] as const) {
      const rule = group[action];
      if (!rule) continue;
      const time = triggerTime(rule.trigger, rule.time, rule.offset, forecast);
      const id = `${forecast.date}:${clock(time).replace(":", "")}`;
      const slot = byMinute.get(id) ?? { id, time, commands: [] };
      const entities: readonly Device[] = group.entities.includes("all")
        ? DEVICES
        : group.entities.filter((device): device is Device => device !== "all");
      slot.commands.push(...entities.map((device) => ({ device, action: action.toUpperCase() as "OPEN" | "CLOSE" })));
      byMinute.set(id, slot);
    }
  }
  return [...byMinute.values()].sort((left, right) => left.time.getTime() - right.time.getTime());
}

function triggerTime(trigger: Trigger, time: string | undefined, offset: number, forecast: DayForecast): Date {
  let base: Date;
  if (trigger === "time") base = new Date(`${forecast.date}T${time}:00`);
  else if (trigger === "sunrise") base = forecast.sunrise;
  else if (trigger === "sunset") base = forecast.sunset;
  else base = forecast.solarZenith;
  return new Date(base.getTime() + offset * 60_000);
}

export function formatStatus(status: PlannerStatus): string {
  const source = status.source === "override" ? "manual override" : `${status.maxTemperature.toFixed(1)} °C forecast`;
  const slots = status.scheduled.length ? status.scheduled.map((slot) => `- ${slot}`).join("\n") : "- none";
  return `Shutter band: ${status.band} (${source})\nScheduled:\n${slots}`;
}

function clock(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function describe(commands: ShutterCommand[]): string {
  return commands.map(({ device, action }) => `${device}:${action.toLowerCase()}`).join(" ");
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}
