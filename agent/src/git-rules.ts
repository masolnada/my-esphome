import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { atomicWrite } from "./forecast.js";
import { parseRules } from "./rules.js";

const RULES_PATH = "agent/skills/shutter-manager/shutter_rules.yaml";

export class GitRules {
  private readonly absoluteRulesPath: string;

  constructor(
    private readonly repoDir: string,
    private readonly remote: string,
    private readonly branch: string,
    private readonly authorName: string,
    private readonly authorEmail: string,
  ) {
    this.absoluteRulesPath = resolve(repoDir, RULES_PATH);
  }

  async read(): Promise<string> {
    return readFile(this.absoluteRulesPath, "utf8");
  }

  async update(expectedContent: string, content: string, commitMessage: string): Promise<{ sha: string; diff: string }> {
    parseRules(content);
    await this.syncClean();
    if (await this.read() !== expectedContent) throw new Error("shutter rules changed since they were read; read them again before editing");
    await atomicWrite(this.absoluteRulesPath, content.endsWith("\n") ? content : `${content}\n`);
    const changed = await this.changedPaths();
    if (changed.some((path) => path !== RULES_PATH)) {
      await this.restoreRemote();
      throw new Error(`refusing to commit paths outside ${RULES_PATH}: ${changed.join(", ")}`);
    }
    if (!changed.length) throw new Error("the proposed rules are unchanged");
    const diff = (await this.git(["diff", "--", RULES_PATH])).stdout.trim();
    await this.git(["add", "--", RULES_PATH]);
    await this.git(["commit", "-m", commitMessage.slice(0, 120)], this.authorEnv());
    const sha = (await this.git(["rev-parse", "HEAD"])).stdout.trim();
    try {
      await this.git(["push", this.remote, `HEAD:${this.branch}`]);
    } catch (error) {
      await this.restoreRemote();
      throw error;
    }
    return { sha, diff };
  }

  async resetToRemote(): Promise<void> {
    await this.git(["fetch", this.remote]);
    await this.git(["reset", "--hard", `${this.remote}/${this.branch}`]);
  }

  private async syncClean(): Promise<void> {
    const changed = await this.changedPaths();
    if (changed.length) throw new Error(`working tree is not clean: ${changed.join(", ")}`);
    await this.git(["pull", "--ff-only", this.remote, this.branch]);
  }

  private async changedPaths(): Promise<string[]> {
    const output = (await this.git(["status", "--porcelain=v1", "-z"])).stdout;
    return output.split("\0").filter(Boolean).map((entry) => {
      const path = entry.slice(3);
      return path.includes(" -> ") ? path.split(" -> ").at(-1)! : path;
    });
  }

  private async restoreRemote(): Promise<void> {
    await this.git(["fetch", this.remote]).catch(() => undefined);
    await this.git(["reset", "--hard", `${this.remote}/${this.branch}`]).catch(() => undefined);
  }

  private authorEnv(): Record<string, string> {
    return {
      GIT_AUTHOR_NAME: this.authorName,
      GIT_AUTHOR_EMAIL: this.authorEmail,
      GIT_COMMITTER_NAME: this.authorName,
      GIT_COMMITTER_EMAIL: this.authorEmail,
    };
  }

  private git(args: string[], extraEnv: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
    return run("git", ["-C", this.repoDir, ...args], extraEnv);
  }
}

function run(command: string, args: string[], extraEnv: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}
