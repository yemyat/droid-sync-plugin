import { getConfig, Config } from "./config.js";
import { SessionData, MessageData } from "./types.js";

export class SyncClient {
  private config: Config;
  private siteUrl: string;

  constructor(config: Config) {
    this.config = config;
    this.siteUrl = config.convexUrl.replace(".convex.cloud", ".convex.site");
  }

  private async request(endpoint: string, data: unknown): Promise<unknown> {
    const url = `${this.siteUrl}${endpoint}`;
    const debug = process.env.DROID_SYNC_DEBUG === "true";

    if (debug) {
      console.error(`[droid-sync:api] POST ${url}`);
      console.error(`[droid-sync:api] Payload: ${JSON.stringify(data)}`);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const text = await response.text();
      if (debug) {
        console.error(`[droid-sync:api] Error ${response.status}: ${text}`);
      }
      throw new Error(`Sync failed: ${response.status} - ${text}`);
    }

    const result = await response.json();
    if (debug) {
      console.error(`[droid-sync:api] Response: ${JSON.stringify(result)}`);
    }
    return result;
  }

  private transformSession(session: SessionData): Record<string, unknown> {
    return {
      externalId: session.sessionId,
      title: session.title,
      projectPath: session.projectPath || session.cwd,
      projectName: session.projectName,
      model: session.model,
      source: session.source,
      promptTokens: session.tokenUsage?.input,
      completionTokens: session.tokenUsage?.output,
      cost: session.costEstimate,
      durationMs: session.durationMs,
    };
  }

  private transformMessage(message: MessageData): Record<string, unknown> {
    return {
      sessionExternalId: message.sessionId,
      externalId: message.messageId,
      role: message.role,
      textContent: message.content || message.toolResult,
      model: undefined,
      durationMs: message.durationMs,
      source: message.source,
      parts: message.toolName
        ? [
            {
              type: "tool_use",
              content: {
                toolName: message.toolName,
                args: message.toolArgs,
                result: message.toolResult,
              },
            },
          ]
        : undefined,
    };
  }

  async syncSession(session: SessionData): Promise<void> {
    const payload = this.transformSession(session);
    await this.request("/sync/session", payload);
  }

  async syncBatch(sessions: SessionData[], messages: MessageData[]): Promise<void> {
    const transformedSessions = sessions.map((s) => this.transformSession(s));
    const transformedMessages = messages.map((m) => this.transformMessage(m));
    await this.request("/sync/batch", {
      sessions: transformedSessions,
      messages: transformedMessages,
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.siteUrl}/health`;
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }
}

let clientInstance: SyncClient | null = null;

export function getClient(): SyncClient | null {
  if (clientInstance) return clientInstance;

  const config = getConfig();
  if (!config) return null;

  clientInstance = new SyncClient(config);
  return clientInstance;
}

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const client = getClient();
  if (!client) {
    return { ok: false, error: "Not configured" };
  }

  const ok = await client.testConnection();
  return ok ? { ok: true } : { ok: false, error: "Connection failed" };
}
