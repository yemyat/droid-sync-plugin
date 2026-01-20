import { readFileSync, existsSync } from "fs";
import { SessionData, MessageData } from "./api.js";

interface TranscriptEntry {
  type: string;
  message?: {
    role: string;
    content?: string | Array<{ type: string; text?: string; tool_use_id?: string; name?: string; input?: unknown }>;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  timestamp?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
}

export interface ParsedSession {
  session: Partial<SessionData>;
  messages: MessageData[];
}

/**
 * Parse a Droid JSONL transcript file
 */
export function parseTranscript(
  transcriptPath: string,
  sessionId: string,
  projectPath?: string
): ParsedSession | null {
  if (!existsSync(transcriptPath)) {
    return null;
  }

  try {
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    const messages: MessageData[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let toolCallCount = 0;
    let startTime: number | undefined;
    let endTime: number | undefined;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as TranscriptEntry;
        const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

        if (!startTime) startTime = timestamp;
        endTime = timestamp;

        // Track token usage
        if (entry.usage) {
          totalPromptTokens += entry.usage.input_tokens || 0;
          totalCompletionTokens += entry.usage.output_tokens || 0;
        }

        // Parse messages
        if (entry.message) {
          const msg = entry.message;
          const role = msg.role as "user" | "assistant" | "system";

          // Extract text content
          let textContent = "";
          if (typeof msg.content === "string") {
            textContent = msg.content;
          } else if (Array.isArray(msg.content)) {
            textContent = msg.content
              .filter((p) => p.type === "text" && p.text)
              .map((p) => p.text)
              .join("\n");
          }

          if (textContent || role === "user") {
            messages.push({
              externalSessionId: sessionId,
              externalMessageId: `${sessionId}-${messages.length}`,
              role,
              textContent: redactSensitive(textContent),
              promptTokens: entry.usage?.input_tokens,
              completionTokens: entry.usage?.output_tokens,
              createdAt: timestamp,
            });
          }

          // Extract tool calls from assistant messages
          if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "tool_use" && part.name) {
                toolCallCount++;
                messages.push({
                  externalSessionId: sessionId,
                  externalMessageId: `${sessionId}-${messages.length}`,
                  role: "assistant",
                  toolName: part.name,
                  toolArgs: part.input as Record<string, unknown>,
                  createdAt: timestamp,
                });
              }
            }
          }
        }

        // Parse standalone tool calls
        if (entry.tool_name) {
          toolCallCount++;
          messages.push({
            externalSessionId: sessionId,
            externalMessageId: `${sessionId}-${messages.length}`,
            role: "assistant",
            toolName: entry.tool_name,
            toolArgs: entry.tool_input,
            toolResult: entry.tool_response ? String(entry.tool_response).slice(0, 1000) : undefined,
            createdAt: timestamp,
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    const session: Partial<SessionData> = {
      externalId: sessionId,
      source: "factory-droid",
      projectPath,
      projectName: projectPath?.split("/").pop(),
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      messageCount: messages.filter((m) => !m.toolName).length,
      toolCallCount,
      startedAt: startTime,
      endedAt: endTime,
      durationMs: startTime && endTime ? endTime - startTime : undefined,
    };

    return { session, messages };
  } catch (e) {
    console.error("Error parsing transcript:", e);
    return null;
  }
}

/**
 * Redact sensitive information from text
 */
function redactSensitive(text: string): string {
  if (!text) return text;

  // Patterns to redact
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
