import { resolve } from "node:path";

export interface Config {
  repoDir: string;
  agentDir: string;
  sessionDir: string;
  stateDir: string;
  rulesPath: string;
  telegramToken: string;
  telegramUserId: number;
  telegramChatId: number;
  telegramPollTimeoutSeconds: number;
  modelProvider: string;
  modelId: string;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  mqttUrl: string;
  mqttUsername: string;
  mqttPassword: string;
  gitRemote: string;
  gitBranch: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const repoDir = resolve(env.HOME_AGENT_REPO_DIR ?? "/data/repo");
  return {
    repoDir,
    agentDir: resolve(env.PI_CODING_AGENT_DIR ?? "/data/pi-agent"),
    sessionDir: resolve(env.PI_CODING_AGENT_SESSION_DIR ?? "/data/sessions"),
    stateDir: resolve(env.HOME_AGENT_STATE_DIR ?? "/data/state"),
    rulesPath: resolve(repoDir, "agent/skills/shutter-manager/shutter_rules.yaml"),
    telegramToken: required(env, "TELEGRAM_BOT_TOKEN"),
    telegramUserId: integer(required(env, "TELEGRAM_USER_ID"), "TELEGRAM_USER_ID"),
    telegramChatId: integer(required(env, "TELEGRAM_CHAT_ID"), "TELEGRAM_CHAT_ID"),
    telegramPollTimeoutSeconds: integer(env.TELEGRAM_POLL_TIMEOUT_SECONDS ?? "45", "TELEGRAM_POLL_TIMEOUT_SECONDS", 1),
    modelProvider: required(env, "PI_MODEL_PROVIDER"),
    modelId: required(env, "PI_MODEL_ID"),
    thinkingLevel: parseThinkingLevel(env.PI_THINKING_LEVEL ?? "medium"),
    mqttUrl: env.MQTT_URL?.trim() || "mqtt://mosquitto:1883",
    mqttUsername: required(env, "MQTT_USERNAME"),
    mqttPassword: required(env, "MQTT_PASSWORD"),
    gitRemote: env.GIT_REMOTE?.trim() || "origin",
    gitBranch: env.GIT_BRANCH?.trim() || "main",
    gitAuthorName: env.GIT_AUTHOR_NAME?.trim() || "Home Agent",
    gitAuthorEmail: env.GIT_AUTHOR_EMAIL?.trim() || "home-agent@local",
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(value: string, name: string, minimum = Number.MIN_SAFE_INTEGER): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return parsed;
}

function parseThinkingLevel(value: string): Config["thinkingLevel"] {
  if (["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)) {
    return value as Config["thinkingLevel"];
  }
  throw new Error(`invalid PI_THINKING_LEVEL: ${value}`);
}
