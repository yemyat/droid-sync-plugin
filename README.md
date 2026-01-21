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

## How It Works

The plugin registers hooks in `~/.factory/settings.json` that sync data in real-time:

| Hook | What It Does |
|------|--------------|
| `SessionStart` | Creates session with project metadata, git branch |
| `UserPromptSubmit` | Syncs each user prompt as it's submitted |
| `PostToolUse` | Syncs tool calls (Read, Write, Bash, etc.) as they complete |
| `Stop` | Updates session stats when Droid finishes responding |
| `SessionEnd` | Finalizes session with end timestamp |

Each message and tool call is sent to your OpenSync backend immediately, so you can monitor sessions in real-time from the dashboard.

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

Or use environment variables:

```bash
export DROID_SYNC_CONVEX_URL="https://your-project.convex.cloud"
export DROID_SYNC_API_KEY="osk_your_api_key"
```

## What Gets Synced

- **Session metadata**: project path, name, git branch, permission mode
- **User prompts**: each prompt synced immediately on submit
- **Tool calls**: tool name, arguments, and results (configurable)
- **Message counts**: total messages and tool call counts

## Privacy

- All data syncs to YOUR Convex deployment only
- Sensitive patterns are automatically redacted (API keys, tokens, passwords, PEM keys)
- File contents from tool results are truncated to 1000 chars

## License

MIT
