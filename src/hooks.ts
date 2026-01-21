import { getClient } from "./api.js";
import { getConfig } from "./config.js";
import { HookInput } from "./types.js";
import {
  parseTranscript,
  parseSessionSettings,
  extractNewMessages,
  markMessagesSynced,
  clearSyncState,
} from "./transcript.js";

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

export async function handleStop(input: HookInput): Promise<void> {
  const client = getClient();
  if (!client) return;

  const config = getConfig();
  if (!config?.autoSync) return;

  if (!input.transcriptPath) return;

  const transcript = parseTranscript(input.transcriptPath);
  const settings = parseSessionSettings(input.transcriptPath);
  const gitBranch = await getGitBranch(input.cwd);

  // Sync session data (creates on first call, updates on subsequent)
  await client.syncSession({
    sessionId: input.sessionId,
    source: "factory-droid",
    projectPath: input.cwd,
    projectName: input.cwd ? input.cwd.split("/").pop() : undefined,
    cwd: input.cwd,
    gitBranch,
    permissionMode: input.permissionMode,
    title: transcript.sessionStart?.title,
    model: settings?.model,
    messageCount: transcript.messageCount,
    toolCallCount: transcript.toolCallCount,
    durationMs: settings?.assistantActiveTimeMs,
    tokenUsage: settings?.tokenUsage
      ? {
          input: settings.tokenUsage.inputTokens ?? 0,
          output: settings.tokenUsage.outputTokens ?? 0,
        }
      : undefined,
  });

  // Extract and sync new messages
  const { newMessages, allMessageIds } = extractNewMessages({
    sessionId: input.sessionId,
    transcript,
    syncToolCalls: config.syncToolCalls ?? true,
    syncThinking: config.syncThinking ?? false,
  });

  if (newMessages.length > 0) {
    await client.syncBatch([], newMessages);
    markMessagesSynced(input.sessionId, allMessageIds);
  }
}

export async function handleSessionEnd(input: HookInput): Promise<void> {
  // Clean up local sync state (synced message IDs cache)
  // All actual syncing is handled by handleStop
  clearSyncState(input.sessionId);
}

export async function dispatchHook(eventName: string): Promise<void> {
  const config = getConfig();
  if (!config || config.autoSync === false) {
    process.exit(0);
  }

  // Read JSON input from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const inputJson = Buffer.concat(chunks).toString("utf-8");

  if (!inputJson.trim()) {
    process.exit(0);
  }

  let input: HookInput;
  try {
    input = JSON.parse(inputJson);
  } catch (e) {
    console.error("[droid-sync] Invalid JSON input:", e);
    process.exit(1);
  }

  const normalizedEvent = eventName.toLowerCase().replace(/-/g, "");

  try {
    switch (normalizedEvent) {
      case "stop":
        await handleStop(input);
        break;
      case "sessionend":
        await handleSessionEnd(input);
        break;
      default:
        // Ignore other events
        break;
    }
    process.exit(0);
  } catch (error) {
    console.error(`[droid-sync] Error: ${error}`);
    process.exit(0);
  }
}
