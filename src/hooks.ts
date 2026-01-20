import { syncSession, syncMessage } from "./api.js";
import { parseTranscript } from "./transcript.js";
import { getConfig } from "./config.js";

// Factory Droid uses camelCase, normalize to snake_case for consistency
interface HookInputRaw {
  // camelCase (actual Factory Droid format)
  sessionId?: string;
  transcriptPath?: string;
  permissionMode?: string;
  hookEventName?: string;
  stopHookActive?: boolean;
  // snake_case (documented format, keeping for compatibility)
  session_id?: string;
  transcript_path?: string;
  permission_mode?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
  // Common fields
  cwd: string;
  source?: string;
  reason?: string;
  prompt?: string;
}

interface HookInput {
  sessionId: string;
  transcriptPath: string;
  cwd: string;
  permissionMode: string;
  hookEventName: string;
  source?: string;
  reason?: string;
  prompt?: string;
  stopHookActive?: boolean;
}

function normalizeInput(raw: HookInputRaw): HookInput {
  return {
    sessionId: raw.sessionId || raw.session_id || "",
    transcriptPath: raw.transcriptPath || raw.transcript_path || "",
    cwd: raw.cwd,
    permissionMode: raw.permissionMode || raw.permission_mode || "default",
    hookEventName: raw.hookEventName || raw.hook_event_name || "",
    source: raw.source,
    reason: raw.reason,
    prompt: raw.prompt,
    stopHookActive: raw.stopHookActive ?? raw.stop_hook_active,
  };
}

/**
 * Handle SessionStart hook
 */
export async function handleSessionStart(input: HookInput): Promise<void> {
  const config = getConfig();
  if (!config?.autoSync) return;

  const gitBranch = await getGitBranch(input.cwd);

  await syncSession({
    externalId: input.sessionId,
    source: "factory-droid",
    projectPath: input.cwd,
    projectName: input.cwd.split("/").pop(),
    cwd: input.cwd,
    gitBranch,
    permissionMode: input.permissionMode,
    startedAt: Date.now(),
  });

  console.log(`[droid-sync] Session started: ${input.sessionId}`);
}

/**
 * Handle Stop hook - sync messages
 */
export async function handleStop(input: HookInput): Promise<void> {
  const config = getConfig();
  if (!config?.autoSync) return;

  const parsed = parseTranscript(input.transcriptPath, input.sessionId, input.cwd);
  if (!parsed) {
    console.error("[droid-sync] Could not parse transcript");
    return;
  }

  // Sync session update
  await syncSession({
    ...parsed.session,
    source: "factory-droid",
  } as Parameters<typeof syncSession>[0]);

  // Sync messages
  if (config.syncToolCalls) {
    for (const msg of parsed.messages) {
      await syncMessage(msg);
    }
  } else {
    // Only sync non-tool messages
    for (const msg of parsed.messages.filter((m) => !m.toolName)) {
      await syncMessage(msg);
    }
  }

  console.log(`[droid-sync] Synced ${parsed.messages.length} messages`);
}

/**
 * Handle SessionEnd hook - finalize session
 */
export async function handleSessionEnd(input: HookInput): Promise<void> {
  const config = getConfig();
  if (!config?.autoSync) return;

  const parsed = parseTranscript(input.transcriptPath, input.sessionId, input.cwd);
  if (!parsed) return;

  // Final sync with end timestamp
  await syncSession({
    ...parsed.session,
    source: "factory-droid",
    endedAt: Date.now(),
  } as Parameters<typeof syncSession>[0]);

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
 * Main hook dispatcher - reads from stdin
 */
export async function dispatchHook(eventName: string): Promise<void> {
  // Read JSON input from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const inputJson = Buffer.concat(chunks).toString("utf-8");

  let rawInput: HookInputRaw;
  try {
    rawInput = JSON.parse(inputJson);
  } catch (e) {
    console.error("[droid-sync] Invalid JSON input:", e);
    process.exit(1);
  }

  const input = normalizeInput(rawInput);

  switch (eventName) {
    case "session-start":
      await handleSessionStart(input);
      break;
    case "stop":
      await handleStop(input);
      break;
    case "session-end":
      await handleSessionEnd(input);
      break;
    default:
      console.error(`[droid-sync] Unknown hook event: ${eventName}`);
      process.exit(1);
  }
}
