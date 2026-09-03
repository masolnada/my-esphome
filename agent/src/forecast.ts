import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast?latitude=41.914&longitude=1.680&daily=temperature_2m_max,sunrise,sunset&timezone=Europe%2FMadrid&forecast_days=7";

interface ForecastResponse {
  daily?: {
    time?: unknown;
    temperature_2m_max?: unknown;
    sunrise?: unknown;
    sunset?: unknown;
  };
}

export interface DayForecast {
  date: string;
  maxTemperature: number;
  sunrise: Date;
  sunset: Date;
  solarZenith: Date;
}

export class ForecastService {
  private readonly cachePath: string;

  constructor(stateDir: string, private readonly fetcher: typeof fetch = fetch) {
    this.cachePath = resolve(stateDir, "forecast.json");
  }

  async today(date = localDate()): Promise<DayForecast> {
    try {
      const response = await this.fetcher(FORECAST_URL, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
      const payload = (await response.json()) as ForecastResponse;
      const forecast = parseForecast(payload, date);
      await atomicWrite(this.cachePath, JSON.stringify(payload));
      return forecast;
    } catch (error) {
      try {
        return parseForecast(JSON.parse(await readFile(this.cachePath, "utf8")) as ForecastResponse, date);
      } catch (cacheError) {
        throw new Error(`forecast unavailable (${message(error)}); cache unavailable (${message(cacheError)})`);
      }
    }
  }
}

export function parseForecast(payload: ForecastResponse, date: string): DayForecast {
  const daily = payload.daily;
  if (!daily || !Array.isArray(daily.time) || !Array.isArray(daily.temperature_2m_max) || !Array.isArray(daily.sunrise) || !Array.isArray(daily.sunset)) {
    throw new Error("forecast response has no usable daily data");
  }
  const index = daily.time.indexOf(date);
  if (index < 0) throw new Error(`forecast has no entry for ${date}`);
  const maxTemperature = daily.temperature_2m_max[index];
  const sunriseText = daily.sunrise[index];
  const sunsetText = daily.sunset[index];
  if (typeof maxTemperature !== "number" || !Number.isFinite(maxTemperature) || typeof sunriseText !== "string" || typeof sunsetText !== "string") {
    throw new Error(`forecast entry for ${date} is incomplete`);
  }
  const sunrise = localDateTime(sunriseText);
  const sunset = localDateTime(sunsetText);
  return {
    date,
    maxTemperature,
    sunrise,
    sunset,
    solarZenith: new Date((sunrise.getTime() + sunset.getTime()) / 2),
  };
}

export function localDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function localDateTime(value: string): Date {
  const parsed = new Date(value.length === 16 ? `${value}:00` : value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid forecast time: ${value}`);
  return parsed;
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
