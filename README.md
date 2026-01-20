# droid-sync

Sync your [Factory Droid](https://factory.ai) coding sessions to [OpenSync](https://opensync.dev).

## Installation

```bash
npm install -g droid-sync
```

## Setup

```bash
# Configure credentials
droid-sync login

# Verify connection
droid-sync status
```

## Usage

Once configured, sessions sync automatically when you use Droid.

The plugin registers hooks in `~/.factory/settings.json` that fire on:
- **SessionStart** - Captures session metadata
- **Stop** - Syncs messages and tool calls
- **SessionEnd** - Finalizes session

## Commands

```
droid-sync login     # Configure credentials
droid-sync logout    # Clear credentials
droid-sync status    # Show connection status
droid-sync verify    # Test connectivity
droid-sync config    # Show configuration
droid-sync version   # Show version
```

## Configuration

Credentials stored at `~/.opensync/droid-credentials.json`:

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

- Session metadata (project, git branch, model)
- User prompts and assistant responses
- Tool calls and results (optional)
- Token usage and cost estimates

## Privacy

- All data goes to YOUR Convex deployment
- Sensitive patterns are automatically redacted
- File contents are not synced

## License

MIT
