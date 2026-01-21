// Hook input from Factory Droid stdin
export interface HookInput {
  sessionId: string;
  transcriptPath: string;
  cwd: string;
  permissionMode: string;
  hookEventName: string;
  source?: string; // SessionStart: "startup" | "resume" | "clear" | "compact"
  reason?: string; // SessionEnd: "clear" | "logout" | "prompt_input_exit" | "other"
}

// Transcript JSONL entry types
export type TranscriptEntry = TranscriptSessionStart | TranscriptMessage;

export interface TranscriptSessionStart {
  type: "session_start";
  id: string;
  title: string;
  sessionTitle: string;
  owner: string;
  version: number;
  cwd: string;
  isSessionTitleManuallySet: boolean;
  sessionTitleAutoStage: string;
}

export interface TranscriptMessage {
  type: "message";
  id: string;
  timestamp: string;
  parentId?: string;
  message: {
    role: "user" | "assistant";
    content: TranscriptContentBlock[];
  };
}

export type TranscriptContentBlock =
  | TranscriptTextBlock
  | TranscriptThinkingBlock
  | TranscriptToolUseBlock
  | TranscriptToolResultBlock
  | TranscriptImageBlock;

export interface TranscriptTextBlock {
  type: "text";
  text: string;
}

export interface TranscriptThinkingBlock {
  type: "thinking";
  signature: string;
  thinking: string;
}

export interface TranscriptToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TranscriptToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export interface TranscriptImageBlock {
  type: "image";
  source: {
    type: "base64";
    data: string;
    media_type: string;
  };
}

// Session settings file (.settings.json)
export interface SessionSettings {
  assistantActiveTimeMs?: number;
  model?: string;
  reasoningEffort?: string;
  autonomyMode?: string;
  providerLock?: string;
  providerLockTimestamp?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    thinkingTokens?: number;
  };
}

// API data types
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
  durationMs?: number;
}

export interface MessageData {
  sessionId: string;
  messageId: string;
  source: "factory-droid";
  role: "user" | "assistant" | "system";
  content?: string;
  thinkingContent?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  durationMs?: number;
  tokenCount?: number;
  timestamp?: string;
}
