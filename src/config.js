// Where the CLI keeps its login: ~/.config/digidropp/config.json (Windows: %APPDATA%\digidropp\config.json).
// DIGIDROPP_TOKEN and DIGIDROPP_API_URL override it, for CI and AI agents.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_API_URL = "https://api.digidropp.online/api";

const configDir = () =>
  process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "digidropp")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "digidropp");

export const configPath = () => path.join(configDir(), "config.json");

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

export function loadConfig() {
  const file = readFile();
  return {
    token: process.env.DIGIDROPP_TOKEN || file.token || null,
    apiUrl: (process.env.DIGIDROPP_API_URL || file.apiUrl || DEFAULT_API_URL).replace(/\/+$/, ""),
  };
}

export function saveConfig(values) {
  fs.mkdirSync(configDir(), { recursive: true });
  // The token can upload builds, so keep the file private to this user.
  fs.writeFileSync(configPath(), JSON.stringify({ ...readFile(), ...values }, null, 2), { mode: 0o600 });
}

export function clearConfig() {
  fs.rmSync(configPath(), { force: true });
}
