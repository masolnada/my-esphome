export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number };
}
interface TelegramUpdate { update_id: number; message?: TelegramMessage }
interface TelegramResponse<T> { ok: boolean; result: T; description?: string }

export class TelegramClient {
  private readonly baseUrl: string;
  private offset = 0;
  private stopped = false;
  private readonly stopController = new AbortController();

  constructor(
    token: string,
    private readonly userId: number,
    private readonly chatId: number,
    private readonly pollTimeoutSeconds: number,
  ) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async send(text: string, replyToMessageId?: number): Promise<number> {
    const body: Record<string, unknown> = { chat_id: this.chatId, text: text.slice(0, 4096), disable_web_page_preview: true };
    if (replyToMessageId !== undefined) body.reply_parameters = { message_id: replyToMessageId };
    const message = await this.call<TelegramMessage>("sendMessage", body);
    return message.message_id;
  }

  async registerCommands(): Promise<void> {
    // Telegram's menu only permits underscores; the parser also accepts the requested /shutter-band spelling.
    await this.call("setMyCommands", { commands: [{ command: "shutter_band", description: "Show or override today's hot/mild/cold band" }] });
  }

  async run(onMessage: (message: TelegramMessage) => Promise<void>): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.call<TelegramUpdate[]>("getUpdates", {
          offset: this.offset,
          timeout: this.pollTimeoutSeconds,
          allowed_updates: ["message"],
        }, (this.pollTimeoutSeconds + 10) * 1_000);
        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          const message = update.message;
          if (!message || !this.authorized(message) || typeof message.text !== "string") continue;
          await onMessage(message);
        }
      } catch (error) {
        if (this.stopped) return;
        console.error("Telegram poll failed:", error);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.stopController.abort();
  }

  private authorized(message: TelegramMessage): boolean {
    return message.from?.id === this.userId && message.chat.id === this.chatId && message.chat.type === "private";
  }

  private async call<T>(method: string, body: unknown, timeoutMs = 15_000): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), this.stopController.signal]),
    });
    const payload = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !payload.ok) throw new Error(`Telegram ${method} failed: ${payload.description ?? response.status}`);
    return payload.result;
  }
}
