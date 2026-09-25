import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ForecastService } from "../src/forecast.js";
import { Planner, buildSlots } from "../src/planner.js";
import { bandForTemperature, parseRules } from "../src/rules.js";
import { mqttCommand } from "../src/shutters.js";

const rulesText = await readFile(new URL("../skills/shutter-manager/shutter_rules.yaml", import.meta.url), "utf8");
const rules = parseRules(rulesText);

test("temperature boundaries and live-derived rule file", () => {
  assert.equal(bandForTemperature(28.1, rules), "hot");
  assert.equal(bandForTemperature(28, rules), "mild");
  assert.equal(bandForTemperature(18, rules), "mild");
  assert.equal(bandForTemperature(17.9, rules), "cold");
  assert.equal(rules.hot.length, 6);
  assert.deepEqual(rules.mild, []);
  assert.deepEqual(rules.cold, []);
});

test("rules reject unknown hardware and excessive offsets", () => {
  assert.throws(() => parseRules(rulesText.replace("persiana-bany", "persiana-inventada")), /known shutter/);
  assert.throws(() => parseRules(rulesText.replace("offset: -60", "offset: -181")), /between -180 and 180/);
});

test("hot rules form nine deterministic time slots", () => {
  const slots = buildSlots(rules.hot, {
    date: "2026-07-01",
    maxTemperature: 35,
    sunrise: new Date("2026-07-01T07:00:00"),
    sunset: new Date("2026-07-01T21:00:00"),
    solarZenith: new Date("2026-07-01T14:00:00"),
  });
  assert.deepEqual(slots.map((slot) => slot.id), [
    "2026-07-01:0700", "2026-07-01:0730", "2026-07-01:1000",
    "2026-07-01:1300", "2026-07-01:1400", "2026-07-01:1500",
    "2026-07-01:1700", "2026-07-01:2030", "2026-07-01:2100",
  ]);
  assert.equal(slots.at(-1)?.commands.length, 3);
});

test("percentage rules expand directly from endpoints and finish at the trigger", () => {
  const forecast = day("2026-07-01");
  const direct = parseRules(minimalRules("position: 50"));
  assert.deepEqual(buildSlots(direct.hot, forecast).map(slot), ["1700 persiana-bany:50"]);

  const opening = parseRules(minimalRules("position: 50\nduration: 10\nsteps: 5"));
  assert.deepEqual(buildSlots(opening.hot, forecast).map(slot), [
    "1652 persiana-bany:10", "1654 persiana-bany:20", "1656 persiana-bany:30",
    "1658 persiana-bany:40", "1700 persiana-bany:50",
  ]);

  const openingDefault = parseRules(minimalRules("duration: 10\nsteps: 5"));
  assert.deepEqual(buildSlots(openingDefault.hot, forecast).map(slot), [
    "1652 persiana-bany:20", "1654 persiana-bany:40", "1656 persiana-bany:60",
    "1658 persiana-bany:80", "1700 persiana-bany:100",
  ]);

  const closing = parseRules(minimalRules("position: 50\nduration: 10\nsteps: 5", "close"));
  assert.deepEqual(buildSlots(closing.hot, forecast).map(slot), [
    "1652 persiana-bany:90", "1654 persiana-bany:80", "1656 persiana-bany:70",
    "1658 persiana-bany:60", "1700 persiana-bany:50",
  ]);
});

test("percentage rule validation rejects unsafe or ambiguous ramps", () => {
  assert.throws(() => parseRules(minimalRules("position: 101")), /position must be between/);
  assert.throws(() => parseRules(minimalRules("position: 50.5")), /position must be an integer/);
  assert.throws(() => parseRules(minimalRules("duration: 10")), /duration and .*steps/);
  assert.throws(() => parseRules(minimalRules("duration: 0\nsteps: 2")), /duration must be positive/);
  assert.throws(() => parseRules(minimalRules("duration: 2\nsteps: 1")), /steps must be at least 2/);
  assert.throws(() => parseRules(minimalRules("duration: 10\nsteps: 3")), /duration must be divisible/);
  assert.throws(() => parseRules(minimalRules("position: 1\nduration: 2\nsteps: 2")), /duplicate positions/);
  assert.throws(() => buildSlots(parseRules(minimalRules("duration: 10\nsteps: 5", "open", "00:04")).hot, day("2026-07-01")), /crosses midnight/);
});

test("identical commands deduplicate and conflicting same-minute targets fail", () => {
  const duplicate = parseRules(minimalRules("position: 50", "open", "17:00", group("second", "open", "position: 50")));
  assert.equal(buildSlots(duplicate.hot, day("2026-07-01"))[0].commands.length, 1);
  const conflict = parseRules(minimalRules("position: 50", "open", "17:00", group("second", "open", "position: 60")));
  assert.throws(() => buildSlots(conflict.hot, day("2026-07-01")), /conflicting targets/);
});

test("failed replanning leaves existing timers and status intact", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "home-agent-"));
  const rulesPath = join(stateDir, "rules.yaml");
  await writeFile(rulesPath, minimalRules("position: 50"));
  const forecast = { today: async () => day(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date())) } as ForecastService;
  const planner = new Planner(rulesPath, forecast, {} as never, stateDir);
  await planner.replan();
  const status = planner.status();
  const timers = (planner as unknown as { timers: NodeJS.Timeout[] }).timers;
  await writeFile(rulesPath, minimalRules("position: 101"));
  await assert.rejects(planner.replan(), /position must be between/);
  assert.equal(planner.status(), status);
  assert.equal((planner as unknown as { timers: NodeJS.Timeout[] }).timers, timers);
  planner.stop();
});

test("MQTT command mapping preserves the ESPHome interface", () => {
  assert.deepEqual(mqttCommand("persiana-bany", "OPEN"), {
    topic: "persiana-bany/cover/blind/command",
    payload: "OPEN",
  });
  assert.deepEqual(mqttCommand("persiana-bany", "50"), {
    topic: "persiana-bany/cover/blind/position/command",
    payload: "50",
  });
});

function day(date: string) {
  return {
    date,
    maxTemperature: 35,
    sunrise: new Date(`${date}T07:00:00`),
    sunset: new Date(`${date}T21:00:00`),
    solarZenith: new Date(`${date}T14:00:00`),
  };
}

function slot(value: { time: Date; commands: Array<{ device: string; action: string }> }): string {
  const time = `${String(value.time.getHours()).padStart(2, "0")}${String(value.time.getMinutes()).padStart(2, "0")}`;
  return `${time} ${value.commands.map(({ device, action }) => `${device}:${action}`).join(" ")}`;
}

function minimalRules(fields: string, action = "open", time = "17:00", extraGroup = ""): string {
  return `thresholds:\n  hot_above: 28\n  cold_below: 18\nhot:\n${group("test", action, fields, time)}${extraGroup}mild: []\ncold: []\n`;
}

function group(name: string, action: string, fields: string, time = "17:00"): string {
  const extra = fields ? `\n      ${fields.replaceAll("\n", "\n      ")}` : "";
  return `  - name: ${name}\n    entities:\n      - persiana-bany\n    ${action}:\n      trigger: time\n      time: "${time}"${extra}\n`;
}

test("forecast cache carries today through a failed fetch", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "home-agent-"));
  const payload = {
    daily: {
      time: ["2026-09-03"],
      temperature_2m_max: [35.1],
      sunrise: ["2026-09-03T07:21"],
      sunset: ["2026-09-03T20:23"],
    },
  };
  const live = new ForecastService(stateDir, async () => new Response(JSON.stringify(payload)));
  assert.equal((await live.today("2026-09-03")).maxTemperature, 35.1);
  const offline = new ForecastService(stateDir, async () => { throw new Error("offline"); });
  assert.equal((await offline.today("2026-09-03")).maxTemperature, 35.1);
});
