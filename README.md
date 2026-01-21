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
| `src/hooks.ts`      | Event handlers: SessionStart, Stop, SessionEnd                         |
| `src/api.ts`        | SyncClient class - HTTP requests to Convex backend                     |
| `src/config.ts`     | Configuration loading/saving                                           |
| `src/transcript.ts` | JSONL transcript parsing, incremental message extraction               |
| `src/types.ts`      | TypeScript type definitions                                            |

### Event Flow

The plugin handles 3 Factory Droid lifecycle events:

1. **SessionStart** → Extract project path, git branch, permission mode; create session in backend
2. **Stop** → Parse transcript JSONL, extract new messages since last sync, batch sync to backend
3. **SessionEnd** → Final message sync, update session with end timestamp, clear sync state

### How Hooks Work

When Factory Droid triggers a hook, it:

1. Invokes `droid-sync hook <EventName>` as a subprocess
2. Pipes JSON context to stdin (sessionId, transcriptPath, cwd, etc.)
3. The CLI reads stdin, parses JSON, dispatches to the appropriate handler

Example hook registration in `~/.factory/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "droid-sync hook SessionStart" }
        ]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "droid-sync hook Stop" }] }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "droid-sync hook SessionEnd" }
        ]
      }
    ]
  }
}
```

### Data Transformation

The plugin transforms Factory Droid's internal schema to the backend's expected format:

```
Plugin receives          →  Backend expects
─────────────────────────────────────────────
sessionId                →  externalId
messageId                →  externalId
content                  →  textContent
tool_use blocks          →  parts[{ type: "tool_use", content: {...} }]
startedAt/endedAt        →  durationMs (calculated)
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
