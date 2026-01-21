import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  TranscriptEntry,
  TranscriptSessionStart,
  TranscriptMessage,
  TranscriptTextBlock,
  TranscriptToolUseBlock,
  MessageData,
} from "./types.js";

const SYNC_STATE_DIR = join(homedir(), ".config", "droid-sync", "state");

function getSyncStateFile(sessionId: string): string {
  return join(SYNC_STATE_DIR, `${sessionId}.json`);
}

interface SyncState {
  syncedMessageIds: string[];
  lastSyncTime: string;
}

function loadSyncState(sessionId: string): SyncState {
  const file = getSyncStateFile(sessionId);
  if (!existsSync(file)) {
    return { syncedMessageIds: [], lastSyncTime: "" };
  }
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return { syncedMessageIds: [], lastSyncTime: "" };
  }
}

function saveSyncState(sessionId: string, state: SyncState): void {
  if (!existsSync(SYNC_STATE_DIR)) {
    mkdirSync(SYNC_STATE_DIR, { recursive: true });
  }
  writeFileSync(getSyncStateFile(sessionId), JSON.stringify(state));
}

export function clearSyncState(sessionId: string): void {
  const file = getSyncStateFile(sessionId);
  if (existsSync(file)) {
    try {
      writeFileSync(file, "{}");
    } catch {
      // Ignore errors
    }
  }
}

export interface ParsedTranscript {
  sessionStart: TranscriptSessionStart | null;
  messages: TranscriptMessage[];
  messageCount: number;
  toolCallCount: number;
}

export function parseTranscript(transcriptPath: string): ParsedTranscript {
  const result: ParsedTranscript = {
    sessionStart: null,
    messages: [],
    messageCount: 0,
    toolCallCount: 0,
  };

  if (!existsSync(transcriptPath)) {
    return result;
  }

  const content = readFileSync(transcriptPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TranscriptEntry;

      if (entry.type === "session_start") {
        result.sessionStart = entry;
      } else if (entry.type === "message") {
        result.messages.push(entry);
        result.messageCount++;

        // Count tool calls in assistant messages
        if (entry.message.role === "assistant") {
          for (const block of entry.message.content) {
            if (block.type === "tool_use") {
              result.toolCallCount++;
            }
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return result;
}

export interface ExtractedMessages {
  newMessages: MessageData[];
  allMessageIds: string[];
}

export function extractNewMessages(opts: {
  sessionId: string;
  transcript: ParsedTranscript;
  syncToolCalls: boolean;
  syncThinking: boolean;
}): ExtractedMessages {
  const { sessionId, transcript, syncToolCalls, syncThinking } = opts;
  const state = loadSyncState(sessionId);
  const syncedSet = new Set(state.syncedMessageIds);

  const newMessages: MessageData[] = [];
  const allMessageIds: string[] = [...state.syncedMessageIds];

  for (const msg of transcript.messages) {
    // Skip if already synced
    if (syncedSet.has(msg.id)) {
      continue;
    }

    const { role, content } = msg.message;

    // Extract text content
    let textContent = "";
    const toolCalls: TranscriptToolUseBlock[] = [];

    for (const block of content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use" && syncToolCalls) {
        toolCalls.push(block);
      } else if (block.type === "thinking" && syncThinking) {
        // Could add thinking content if desired
      }
    }

    // Add text message if there's content
    if (textContent.trim()) {
      newMessages.push({
        sessionId,
        messageId: msg.id,
        source: "factory-droid",
        role,
        content: redactSensitive(textContent),
        timestamp: msg.timestamp,
      });
      allMessageIds.push(msg.id);
    }

    // Add tool calls as separate messages
    for (const tool of toolCalls) {
      const toolMessageId = `${msg.id}-tool-${tool.id}`;
      if (!syncedSet.has(toolMessageId)) {
        newMessages.push({
          sessionId,
          messageId: toolMessageId,
          source: "factory-droid",
          role: "assistant",
          toolName: tool.name,
          toolArgs: tool.input,
          timestamp: msg.timestamp,
        });
        allMessageIds.push(toolMessageId);
      }
    }
  }

  return { newMessages, allMessageIds };
}

export function markMessagesSynced(sessionId: string, messageIds: string[]): void {
  const state = loadSyncState(sessionId);
  const syncedSet = new Set(state.syncedMessageIds);

  for (const id of messageIds) {
    syncedSet.add(id);
  }

  saveSyncState(sessionId, {
    syncedMessageIds: Array.from(syncedSet),
    lastSyncTime: new Date().toISOString(),
  });
}

function redactSensitive(text: string): string {
  if (!text) return text;

  const patterns = [
    /(?:api[_-]?key|apikey|secret|password|token|auth)[=:\s]+["']?[\w\-./+=]{8,}["']?/gi,
    /(?:sk-|pk_|rk_)[\w\-]{20,}/g,
    /ghp_[\w]{36}/g,
    /xoxb-[\w\-]+/g,
    /-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g,
  ];

  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
