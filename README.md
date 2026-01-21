# droid-sync

Sync your [Factory Droid](https://factory.ai) coding sessions to [OpenSync](https://opensync.dev) in real-time.

## Installation

```bash
npm install -g droid-sync
```

## Setup

```bash
# Configure credentials and register hooks
droid-sync login

# Verify connection
droid-sync status
```

## Core Architecture

```
Factory Droid  →  hooks (stdin JSON)  →  CLI parses  →  SyncClient  →  Convex Backend
```

### Source Files

| File                | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `src/cli.ts`        | CLI entry point: `login`, `logout`, `status`, `verify`, `hook <event>` |
| `src/hooks.ts`      | Event handlers (primary: Stop)                                         |
| `src/api.ts`        | SyncClient class - HTTP requests to Convex backend                     |
| `src/config.ts`     | Configuration loading/saving                                           |
| `src/transcript.ts` | JSONL transcript parsing, incremental message extraction               |
| `src/types.ts`      | TypeScript type definitions                                            |

### Event Flow

The plugin uses the **Stop** event for all syncing:

1. **Stop** → Creates/updates session with metadata (project, git branch, model, tokens, duration), parses transcript, syncs new messages
2. **SessionEnd** → Clears local sync state (synced message ID cache)

### How Hooks Work

When Factory Droid triggers a hook, it:

1. Invokes `droid-sync hook <EventName>` as a subprocess
2. Pipes JSON context to stdin (sessionId, transcriptPath, cwd, etc.)
3. The CLI reads stdin, parses JSON, dispatches to the appropriate handler

Example hook registration in `~/.factory/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "droid-sync hook Stop" }] }
    ]
  }
}
```

> **Note:** Only the `Stop` hook is required. `SessionEnd` only clears local cache.

### Data Transformation

The plugin transforms Factory Droid's internal schema to the backend's expected format:

```
Plugin receives              →  Backend expects
───────────────────────────────────────────────────
sessionId                    →  externalId
messageId                    →  externalId
content                      →  textContent
tool_use blocks              →  parts[{ type: "tool_use", content: {...} }]
assistantActiveTimeMs        →  durationMs
tokenUsage.inputTokens       →  tokenUsage.input
tokenUsage.outputTokens      →  tokenUsage.output
```

This mapping happens in `transformSession()` and `transformMessage()` methods in `src/api.ts`.

### Incremental Sync

Messages are synced incrementally to avoid duplicates:

1. On each `Stop` event, parse the transcript JSONL file
2. Load previously synced message IDs from state file
3. Extract only new messages not in the synced set
4. Sync new messages via batch API
5. Save updated message IDs to state file

State files: `~/.config/droid-sync/state/{sessionId}.json`

### Config Storage

| Location                           | Purpose                                          |
| ---------------------------------- | ------------------------------------------------ |
| `~/.config/droid-sync/config.json` | Primary config (convexUrl, apiKey, sync options) |
| `~/.factory/settings.json`         | Hook registrations                               |
| `~/.config/droid-sync/state/`      | Per-session sync state (synced message IDs)      |
| Environment variables              | Override config (`DROID_SYNC_*`)                 |

## Commands

```
droid-sync login     # Configure credentials and register hooks
droid-sync logout    # Clear credentials
droid-sync status    # Show connection status
droid-sync verify    # Test connectivity
droid-sync config    # Show configuration
droid-sync version   # Show version
```

## Configuration

Config file: `~/.config/droid-sync/config.json`

```json
{
  "convexUrl": "https://your-project.convex.cloud",
  "apiKey": "osk_your_api_key",
  "autoSync": true,
  "syncToolCalls": true,
  "syncThinking": false
}
```

## License

MIT
