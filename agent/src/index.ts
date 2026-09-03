import { mkdir } from "node:fs/promises";
import { HomeAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { ForecastService } from "./forecast.js";
import { GitRules } from "./git-rules.js";
import { formatStatus, Planner } from "./planner.js";
import { isBand } from "./rules.js";
import { Shutters } from "./shutters.js";
import { TelegramClient, type TelegramMessage } from "./telegram.js";

const config = loadConfig();
await Promise.all([
  mkdir(config.agentDir, { recursive: true, mode: 0o700 }),
  mkdir(config.sessionDir, { recursive: true, mode: 0o700 }),
  mkdir(config.stateDir, { recursive: true, mode: 0o700 }),
]);

const telegram = new TelegramClient(config.telegramToken, config.telegramUserId, config.telegramChatId, config.telegramPollTimeoutSeconds);
const gitRules = new GitRules(config.repoDir, config.gitRemote, config.gitBranch, config.gitAuthorName, config.gitAuthorEmail);
await gitRules.resetToRemote();
const shutters = new Shutters(config.mqttUrl, config.mqttUsername, config.mqttPassword);
const planner = new Planner(config.rulesPath, new ForecastService(config.stateDir), shutters, config.stateDir);
await planner.start().catch((error) => console.error("Initial planning failed:", error));
await telegram.registerCommands().catch((error) => console.error("Telegram command registration failed:", error));

let agentPromise: Promise<HomeAgent> | undefined;
let agentInstance: HomeAgent | undefined;
function agent(): Promise<HomeAgent> {
  agentPromise ??= startAgent();
  return agentPromise;
}
async function startAgent(): Promise<HomeAgent> {
  const instance = new HomeAgent(config, gitRules, planner, shutters, telegram);
  try {
    await instance.initialize();
    agentInstance = instance;
    return instance;
  } catch (error) {
    instance.dispose();
    agentPromise = undefined;
    throw error;
  }
}

let queue = Promise.resolve();
const telegramLoop = telegram.run((message) => {
  const result = queue.then(() => handleMessage(message));
  queue = result.catch(() => undefined);
  return result;
});

async function handleMessage(message: TelegramMessage): Promise<void> {
  const text = message.text?.trim();
  if (!text) return;
  const match = /^\/shutter[-_]band(?:@\w+)?(?:\s+(\S+))?$/i.exec(text);
  if (match) {
    const requested = match[1]?.toLowerCase();
    if (!requested) {
      const status = planner.status() ?? await planner.replan();
      await telegram.send(formatStatus(status), message.message_id);
      return;
    }
    if (!isBand(requested)) {
      await telegram.send("Usage: /shutter-band hot|mild|cold", message.message_id);
      return;
    }
    const status = await planner.setOverride(requested);
    await telegram.send(formatStatus(status), message.message_id);
    return;
  }
  if (/^\/status(?:@\w+)?$/i.test(text)) {
    const status = planner.status() ?? await planner.replan();
    await telegram.send(formatStatus(status), message.message_id);
    return;
  }
  try {
    const output = await (await agent()).prompt(text);
    if (output) await telegram.send(output, message.message_id);
  } catch (error) {
    console.error("Agent turn failed:", error);
    await telegram.send(`I could not complete that: ${error instanceof Error ? error.message : String(error)}`, message.message_id);
  }
}

async function shutdown(): Promise<void> {
  telegram.stop();
  planner.stop();
  agentInstance?.dispose();
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
await telegramLoop;
