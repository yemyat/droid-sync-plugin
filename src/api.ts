import { getConfig, Config } from "./config.js";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// File-based logging
const LOG_DIR = join(homedir(), ".config", "droid-sync");
const LOG_FILE = join(LOG_DIR, "debug.log");

function fileLog(msg: string): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
  } catch {
    // Ignore logging errors
  }
}

export interface SessionData {
  sessionId: string;
  source: "factory-droid";
  title?: string;
  projectPath?: string;
  projectName?: string;
  cwd?: string;
  gitBranch?: string;
  model?: string;
  permissionMode?: string;
  tokenUsage?: { input: number; output: number };
  costEstimate?: number;
  messageCount?: number;
  toolCallCount?: number;
  startedAt?: string;
  endedAt?: string;
}

export interface MessageData {
  sessionId: string;
  messageId: string;
  source: "factory-droid";
  role: "user" | "assistant" | "system";
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  durationMs?: number;
  timestamp?: string;
}

export class SyncClient {
  private config: Config;
  private siteUrl: string;
  private sessionCache: Map<string, Partial<SessionData>> = new Map();

  constructor(config: Config) {
    this.config = config;
    this.siteUrl = config.convexUrl.replace(".convex.cloud", ".convex.site");
  }

  private async request(endpoint: string, data: unknown): Promise<unknown> {
    const url = `${this.siteUrl}${endpoint}`;
    const debug = process.env.DROID_SYNC_DEBUG === "true";

    fileLog(`[api] POST ${url}`);
    fileLog(`[api] Payload: ${JSON.stringify(data)}`);
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
      fileLog(`[api] Error ${response.status}: ${text}`);
      if (debug) {
        console.error(`[droid-sync:api] Error ${response.status}: ${text}`);
      }
      throw new Error(`Sync failed: ${response.status} - ${text}`);
    }

    const result = await response.json();
    fileLog(`[api] Response: ${JSON.stringify(result)}`);
    if (debug) {
      console.error(`[droid-sync:api] Response: ${JSON.stringify(result)}`);
    }
    return result;
  }

  private transformSession(session: SessionData): Record<string, unknown> {
    const startTime = session.startedAt ? new Date(session.startedAt).getTime() : undefined;
    const endTime = session.endedAt ? new Date(session.endedAt).getTime() : undefined;

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
      messageCount: session.messageCount,
      toolCallCount: session.toolCallCount,
      durationMs: startTime && endTime ? endTime - startTime : undefined,
    };
  }

  private transformMessage(message: MessageData): Record<string, unknown> {
    return {
      sessionExternalId: message.sessionId,
      externalId: message.messageId,
      role: message.role,
      textContent: message.content || message.toolResult,
      source: message.source,
      durationMs: message.durationMs,
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
    try {
      const payload = this.transformSession(session);
      await this.request("/sync/session", payload);
    } catch (error) {
      console.error("[droid-sync] Failed to sync session:", error);
      throw error;
    }
  }

  async syncMessage(message: MessageData): Promise<void> {
    try {
      const payload = this.transformMessage(message);
      await this.request("/sync/message", payload);
    } catch (error) {
      console.error("[droid-sync] Failed to sync message:", error);
      throw error;
    }
  }

  async syncBatch(sessions: SessionData[], messages: MessageData[]): Promise<void> {
    try {
      const transformedSessions = sessions.map((s) => this.transformSession(s));
      const transformedMessages = messages.map((m) => this.transformMessage(m));
      await this.request("/sync/batch", {
        sessions: transformedSessions,
        messages: transformedMessages,
      });
    } catch (error) {
      console.error("[droid-sync] Failed to sync batch:", error);
      throw error;
    }
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

  getSessionState(sessionId: string): Partial<SessionData> {
    return this.sessionCache.get(sessionId) || {};
  }

  updateSessionState(sessionId: string, updates: Partial<SessionData>): void {
    const current = this.sessionCache.get(sessionId) || {};
    this.sessionCache.set(sessionId, { ...current, ...updates });
  }

  clearSessionState(sessionId: string): void {
    this.sessionCache.delete(sessionId);
  }
}

// Singleton client instance
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
