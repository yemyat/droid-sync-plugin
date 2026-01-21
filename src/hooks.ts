import { getClient, SessionData } from "./api.js";
import { getConfig } from "./config.js";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// File-based logging for debugging hook invocations
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

// Transcript file format (JSONL)
interface TranscriptEntry {
  type: "session_start" | "message";
  id?: string;
  timestamp?: string;
  // session_start fields
  sessionTitle?: string;
  title?: string;
  // message fields
  message?: {
    role: "user" | "assistant";
    content: Array<{ type: string; text?: string; thinking?: string }> | string;
  };
}

// Factory Droid hook input (mixed casing as per actual input)
interface HookInput {
  // Common fields (camelCase)
  sessionId: string;
  transcriptPath: string;
  cwd: string;
  permissionMode: string;
  hookEventName: string;
  // Event-specific fields
  source?: string; // SessionStart: "startup" | "resume" | "clear" | "compact"
  reason?: string; // SessionEnd: "clear" | "logout" | "prompt_input_exit" | "other"
  prompt?: string; // UserPromptSubmit
  stopHookActive?: boolean; // Stop/SubagentStop
  // Tool fields (snake_case per actual Factory input)
  tool_name?: string; // PreToolUse/PostToolUse
  tool_input?: Record<string, unknown>; // PreToolUse/PostToolUse
  tool_response?: unknown; // PostToolUse
  message?: string; // Notification
}



const debug = () => process.env.DROID_SYNC_DEBUG === "true";
const log = (event: string, msg: string) => debug() && console.error(`[droid-sync:${event}] ${msg}`);

/**
 * Handle SessionStart hook
 */
export async function handleSessionStart(input: HookInput): Promise<void> {
  const client = getClient();
  if (!client) {
    log("SessionStart", "No client - skipping");
    return;
  }

  const config = getConfig();
  if (!config?.autoSync) {
    log("SessionStart", "autoSync disabled - skipping");
    return;
  }

  const gitBranch = await getGitBranch(input.cwd);

  const session: SessionData = {
    sessionId: input.sessionId,
    source: "factory-droid",
    projectPath: input.cwd,
    projectName: input.cwd.split("/").pop(),
    cwd: input.cwd,
    gitBranch,
    permissionMode: input.permissionMode,
    startedAt: new Date().toISOString(),
  };

  client.updateSessionState(input.sessionId, session);
  log("SessionStart", `Syncing session: ${JSON.stringify(session)}`);
  await client.syncSession(session);

  console.log(`[droid-sync] Session started: ${input.sessionId}`);
}

/**
 * Handle UserPromptSubmit hook - sync user prompt in real-time
 */
export async function handleUserPromptSubmit(input: HookInput): Promise<void> {
  const client = getClient();
  if (!client) return;

  const config = getConfig();
  if (!config?.autoSync) return;

  if (!input.prompt) return;

  const timestamp = Date.now();

  // Use first prompt as session title if not set
  const currentState = client.getSessionState(input.sessionId);
  if (!currentState.title) {
    const title = input.prompt.slice(0, 100) + (input.prompt.length > 100 ? "..." : "");
    client.updateSessionState(input.sessionId, { title });
  }

  await client.syncMessage({
    sessionId: input.sessionId,
    messageId: `${input.sessionId}-user-${timestamp}`,
    source: "factory-droid",
    role: "user",
    content: redactSensitive(input.prompt),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle PostToolUse hook - sync tool usage in real-time
 */
export async function handlePostToolUse(input: HookInput): Promise<void> {
  const client = getClient();
  if (!client) return;

  const config = getConfig();
  if (!config?.autoSync || !config?.syncToolCalls) return;

  if (!input.tool_name) return;

  const timestamp = Date.now();

  const toolResult = input.tool_response
    ? typeof input.tool_response === "string"
      ? input.tool_response.slice(0, 1000)
      : JSON.stringify(input.tool_response).slice(0, 1000)
    : undefined;

  await client.syncMessage({
    sessionId: input.sessionId,
    messageId: `${input.sessionId}-tool-${timestamp}`,
    source: "factory-droid",
    role: "assistant",
    toolName: input.tool_name,
    toolArgs: input.tool_input,
    toolResult,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle Stop hook - Claude finished responding, read transcript for assistant message
 * Factory Droid doesn't have an AssistantResponse hook, so we read the transcript
 * to extract the latest assistant response when Claude stops.
 */
export async function handleStop(input: HookInput): Promise<void> {
  const client = getClient();
  if (!client) return;

  const config = getConfig();
  if (!config?.autoSync) return;

  if (!input.transcriptPath) {
    fileLog(`[stop] No transcriptPath provided`);
    return;
  }

  try {
    const { readFileSync } = await import("fs");
    const content = readFileSync(input.transcriptPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Find session_start entry for session title and last assistant message
    let sessionStartEntry: TranscriptEntry | null = null;
    let lastAssistantEntry: TranscriptEntry | null = null;

    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]) as TranscriptEntry;
        if (entry.type === "session_start" && !sessionStartEntry) {
          sessionStartEntry = entry;
        }
        if (entry.type === "message" && entry.message?.role === "assistant") {
          lastAssistantEntry = entry;
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Sync session title if available
    if (sessionStartEntry?.sessionTitle) {
      fileLog(`[stop] Syncing session title: ${sessionStartEntry.sessionTitle.slice(0, 50)}...`);
      await client.syncSession({
        sessionId: input.sessionId,
        source: "factory-droid",
        title: sessionStartEntry.sessionTitle,
      });
    }

    if (!lastAssistantEntry?.message) {
      fileLog(`[stop] No assistant message found in transcript`);
      return;
    }

    // Extract text content from assistant message
    const message = lastAssistantEntry.message;
    let textContent = "";
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          textContent += block.text;
        }
      }
    } else if (typeof message.content === "string") {
      textContent = message.content;
    }

    if (!textContent) {
      fileLog(`[stop] Assistant message has no text content`);
      return;
    }

    fileLog(`[stop] Syncing assistant response: ${textContent.slice(0, 100)}...`);

    await client.syncMessage({
      sessionId: input.sessionId,
      messageId: lastAssistantEntry.id || `${input.sessionId}-assistant-${Date.now()}`,
      source: "factory-droid",
      role: "assistant",
      content: redactSensitive(textContent),
      timestamp: lastAssistantEntry.timestamp || new Date().toISOString(),
    });

    fileLog(`[stop] Assistant response synced successfully`);
  } catch (error) {
    fileLog(`[stop] Error reading transcript: ${error}`);
  }
}

/**
 * Handle SessionEnd hook - finalize session
 * Following Wayne's pattern: only send minimal data (sessionId, reason, endedAt).
 * The backend aggregates message/tool counts from individually synced messages.
 */
export async function handleSessionEnd(input: HookInput): Promise<void> {
  const client = getClient();
  if (!client) {
    log("SessionEnd", "No client - skipping");
    return;
  }

  const config = getConfig();
  if (!config?.autoSync) {
    log("SessionEnd", "autoSync disabled - skipping");
    return;
  }

  const session: SessionData = {
    sessionId: input.sessionId,
    source: "factory-droid",
    endedAt: new Date().toISOString(),
  };

  log("SessionEnd", `Syncing session end: ${JSON.stringify(session)}`);
  await client.syncSession(session);

  console.log(`[droid-sync] Session ended: ${input.sessionId}`);
}

/**
 * Get current git branch
 */
async function getGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { execSync } = await import("child_process");
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Redact sensitive information from text
 */
function redactSensitive(text: string): string {
  if (!text) return text;

  const patterns = [
    /(?:api[_-]?key|apikey|secret|password|token|auth)[=:\s]+["']?[\w\-./+=]{8,}["']?/gi,
    /(?:sk-|pk_|rk_)[\w\-]{20,}/g, // API keys
    /ghp_[\w]{36}/g, // GitHub tokens
    /xoxb-[\w\-]+/g, // Slack tokens
    /-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g, // PEM keys
  ];

  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Main hook dispatcher - reads from stdin
 */
export async function dispatchHook(eventName: string): Promise<void> {
  const debug = process.env.DROID_SYNC_DEBUG === "true";
  const log = (msg: string) => {
    fileLog(`[${eventName}] ${msg}`);
    debug && console.error(`[droid-sync:${eventName}] ${msg}`);
  };

  log("Hook started");

  const config = getConfig();
  if (!config) {
    log("No config found - exiting");
    process.exit(0);
  }

  log(`Config loaded: autoSync=${config.autoSync}, url=${config.convexUrl}`);

  if (config.autoSync === false) {
    log("autoSync disabled - exiting");
    process.exit(0);
  }

  // Read JSON input from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const inputJson = Buffer.concat(chunks).toString("utf-8");

  if (!inputJson.trim()) {
    log("Empty stdin - exiting");
    process.exit(0);
  }

  log(`Received ${inputJson.length} bytes from stdin`);
  log(`Raw input: ${inputJson}`);

  let input: HookInput;
  try {
    input = JSON.parse(inputJson);
  } catch (e) {
    console.error("[droid-sync] Invalid JSON input:", e);
    log(`JSON parse error: ${e}`);
    process.exit(1);
  }

  log(`Parsed input keys: ${Object.keys(input).join(", ")}`);
  log(`Parsed input: sessionId=${input.sessionId}`);

  // Normalize event name to handle various casings (session-start, SessionStart, sessionstart)
  const normalizedEvent = eventName.toLowerCase().replace(/-/g, "");

  try {
    switch (normalizedEvent) {
      case "sessionstart":
        await handleSessionStart(input);
        break;
      case "userpromptsubmit":
        await handleUserPromptSubmit(input);
        break;
      case "posttooluse":
        await handlePostToolUse(input);
        break;
      case "stop":
        await handleStop(input);
        break;
      case "sessionend":
        await handleSessionEnd(input);
        break;
      default:
        log(`Unknown event: ${eventName} (normalized: ${normalizedEvent})`);
        break;
    }
    log("Hook completed successfully");
    process.exit(0);
  } catch (error) {
    console.error(`[droid-sync] Error: ${error}`);
    process.exit(0);
  }
}
