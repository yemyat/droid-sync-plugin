#!/usr/bin/env node

import { createInterface } from "readline";
import { getConfig, setConfig, clearConfig, getConfigPaths, Config } from "./config.js";
import { testConnection } from "./api.js";
import { dispatchHook } from "./hooks.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const VERSION = "0.1.0";

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function login(): Promise<void> {
  console.log("🔧 droid-sync login\n");

  const convexUrl = await prompt("Convex URL (e.g., https://your-project.convex.cloud): ");
  if (!convexUrl) {
    console.error("❌ Convex URL is required");
    process.exit(1);
  }

  const apiKey = await prompt("API Key (starts with osk_): ");
  if (!apiKey) {
    console.error("❌ API Key is required");
    process.exit(1);
  }

  const config: Config = {
    convexUrl,
    apiKey,
    autoSync: true,
    syncToolCalls: true,
    syncThinking: false,
  };

  setConfig(config);

  console.log("\n⏳ Testing connection...");
  const result = await testConnection();

  if (result.ok) {
    console.log("✅ Connected successfully!");
    console.log("\n📝 Registering hooks...");
    await registerHooks();
    console.log("✅ Hooks registered in ~/.factory/settings.json");
  } else {
    console.error(`❌ Connection failed: ${result.error}`);
    process.exit(1);
  }
}

async function logout(): Promise<void> {
  clearConfig();
  console.log("✅ Credentials cleared");
}

async function status(): Promise<void> {
  console.log("📊 droid-sync - Status\n");

  const config = getConfig();
  if (!config) {
    console.log("❌ Not configured. Run: droid-sync login");
    return;
  }

  console.log("Configuration:");
  console.log(`  Convex URL: ${config.convexUrl}`);
  console.log(`  API Key:    ${config.apiKey.slice(0, 8)}****${config.apiKey.slice(-4)}`);
  console.log(`  Auto Sync:  ${config.autoSync ? "enabled" : "disabled"}`);
  console.log(`  Tool Calls: ${config.syncToolCalls ? "enabled" : "disabled"}`);
  console.log(`  Thinking:   ${config.syncThinking ? "enabled" : "disabled"}`);

  console.log("\n⏳ Testing connection...");
  const result = await testConnection();

  if (result.ok) {
    console.log("✅ Connected to OpenSync backend");
  } else {
    console.log(`❌ Connection failed: ${result.error}`);
  }
}

async function verify(): Promise<void> {
  const config = getConfig();
  if (!config) {
    console.log("❌ Not configured. Run: droid-sync login");
    process.exit(1);
  }

  console.log("⏳ Verifying connection...");
  const result = await testConnection();

  if (result.ok) {
    console.log("✅ Connection verified");
  } else {
    console.error(`❌ Verification failed: ${result.error}`);
    process.exit(1);
  }
}

async function registerHooks(): Promise<void> {
  const settingsPath = join(homedir(), ".factory", "settings.json");
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  // Merge hooks
  const hooks = (settings.hooks as Record<string, unknown[]>) || {};

  const droidSyncHooks = {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: "droid-sync hook SessionStart",
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: "droid-sync hook UserPromptSubmit",
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: "droid-sync hook PostToolUse",
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: "droid-sync hook Stop",
          },
        ],
      },
    ],
    SessionEnd: [
      {
        hooks: [
          {
            type: "command",
            command: "droid-sync hook SessionEnd",
          },
        ],
      },
    ],
  };

  for (const [event, eventHooks] of Object.entries(droidSyncHooks)) {
    const existing = hooks[event] || [];
    // Check if our hook is already registered
    const hasOurHook = (existing as Array<{ hooks?: Array<{ command?: string }> }>).some((h) =>
      h.hooks?.some((hh) => hh.command?.startsWith("droid-sync"))
    );
    if (!hasOurHook) {
      hooks[event] = [...existing, ...eventHooks];
    }
  }

  settings.hooks = hooks;

  // Ensure directory exists
  const { mkdirSync } = await import("fs");
  mkdirSync(join(homedir(), ".factory"), { recursive: true });

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

async function showConfig(): Promise<void> {
  const config = getConfig();
  if (!config) {
    console.log("Not configured. Run: droid-sync login");
    return;
  }
  console.log(JSON.stringify(config, null, 2));
}

function showHelp(): void {
  console.log(`
droid-sync v${VERSION}

Sync Factory Droid sessions to OpenSync dashboard.

COMMANDS:
  login         Configure Convex URL and API Key
  logout        Clear stored credentials
  status        Show authentication and connection status
  verify        Test connectivity to OpenSync
  config        Show current configuration
  hook <event>  Handle a Droid hook event (internal use)
  version       Show version
  help          Show this help

EXAMPLES:
  droid-sync login
  droid-sync status
  droid-sync verify

CONFIG FILE:
  ~/.config/droid-sync/config.json

DOCUMENTATION:
  https://docs.opensync.dev/factory-droid-plugin
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "login":
      await login();
      break;
    case "logout":
      await logout();
      break;
    case "status":
      await status();
      break;
    case "verify":
      await verify();
      break;
    case "config":
      await showConfig();
      break;
    case "hook":
      const eventName = args[1];
      if (!eventName) {
        console.error("Missing hook event name");
        process.exit(1);
      }
      await dispatchHook(eventName);
      break;
    case "version":
    case "-v":
    case "--version":
      console.log(VERSION);
      break;
    case "help":
    case "-h":
    case "--help":
    default:
      showHelp();
      break;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
