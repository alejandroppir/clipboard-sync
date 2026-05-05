import fs from 'fs';
import path from 'path';
import os from 'os';
import {app} from 'electron';

export interface Config {
  userId: string;
}

function getConfigDir(): string {
  // app.getPath('appData') = %APPDATA%, pero queremos %LOCALAPPDATA%
  const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'clipboard-sync');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function loadConfig(): Config | null {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    if (!parsed.userId) return null;
    return {userId: parsed.userId};
  } catch {
    return null;
  }
}

export function saveConfig(config: Config): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
}

export function ensureConfigDir(): void {
  fs.mkdirSync(getConfigDir(), {recursive: true});
}
