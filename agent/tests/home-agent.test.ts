import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ForecastService } from "../src/forecast.js";
import { buildSlots } from "../src/planner.js";
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
