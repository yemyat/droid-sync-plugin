import { getConfig } from "./config.js";

export interface SessionData {
  externalId: string;
  source: "factory-droid";
  projectPath?: string;
  projectName?: string;
  cwd?: string;
  gitBranch?: string;
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  durationMs?: number;
  messageCount?: number;
  toolCallCount?: number;
  permissionMode?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface MessageData {
  externalSessionId: string;
  externalMessageId: string;
  role: "user" | "assistant" | "system";
  textContent?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  createdAt?: number;
}

async function request(
  endpoint: string,
  method: string,
  body?: unknown
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const config = getConfig();
  if (!config) {
    return { ok: false, error: "Not configured. Run: droid-sync login" };
  }

  try {
    const url = `${config.convexUrl}${endpoint}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }

    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function syncSession(session: SessionData) {
  return request("/sync/session", "POST", session);
}

export async function syncMessage(message: MessageData) {
  return request("/sync/message", "POST", message);
}

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const config = getConfig();
  if (!config) {
    return { ok: false, error: "Not configured" };
  }

  try {
    const res = await fetch(`${config.convexUrl}/api/stats`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });

    if (res.ok) {
      return { ok: true };
    }

    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
