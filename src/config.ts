import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export interface Config {
  convexUrl: string;
  apiKey: string;
  autoSync: boolean;
  syncToolCalls: boolean;
  syncThinking: boolean;
}

const CONFIG_DIR = join(homedir(), ".opensync");
const CONFIG_FILE = join(CONFIG_DIR, "droid-credentials.json");

export function getConfigPaths() {
  return { configDir: CONFIG_DIR, configFile: CONFIG_FILE };
}

export function getConfig(): Config | null {
  // Check env vars first
  const envUrl = process.env.DROID_SYNC_CONVEX_URL;
  const envKey = process.env.DROID_SYNC_API_KEY;

  if (envUrl && envKey) {
    return {
      convexUrl: normalizeUrl(envUrl),
      apiKey: envKey,
      autoSync: process.env.DROID_SYNC_AUTO_SYNC !== "false",
      syncToolCalls: process.env.DROID_SYNC_TOOL_CALLS !== "false",
      syncThinking: process.env.DROID_SYNC_THINKING === "true",
    };
  }

  // Fall back to config file
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const data = readFileSync(CONFIG_FILE, "utf-8");
    const config = JSON.parse(data) as Config;
    config.convexUrl = normalizeUrl(config.convexUrl);
    return config;
  } catch {
    return null;
  }
}

export function setConfig(config: Config): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("Error saving config:", e);
  }
}

export function clearConfig(): void {
  try {
    if (existsSync(CONFIG_FILE)) {
      writeFileSync(CONFIG_FILE, "{}");
    }
  } catch (e) {
    console.error("Error clearing config:", e);
  }
}

function normalizeUrl(url: string): string {
  // Convert .convex.cloud to .convex.site for API calls
  return url.replace(/\.convex\.cloud$/, ".convex.site");
}
