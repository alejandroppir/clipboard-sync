/**
 * updater-engine
 *
 * Invoked by the C# UpdateForm AFTER app.zip has already been downloaded and
 * verified. Receives the installation directory as argv[2].
 *
 * Responsibilities:
 *   1. Kill clipboard-sync-ui and clipboard-sync-engine if running
 *   2. Copy all files from tmp_updater/ to AppDir/ (excluding updater.exe, app.zip)
 *   3. Print progress as JSON lines to stdout
 *   4. Exit 0 on success, 1 on failure
 *
 * Progress line format:
 *   { "step": "kill" | "copy" | "done", "message": "...", "pct": 0-100 }
 *   { "step": "error", "message": "..." }
 */

import * as fs from 'fs';
import * as path from 'path';
import {execSync} from 'child_process';

function send(obj: object): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function killProcess(name: string): void {
  try {
    execSync(`taskkill /IM "${name}.exe" /F`, {stdio: 'ignore'});
  } catch {
    // Not running — ignore
  }
}

function getAllFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...getAllFiles(full));
    else files.push(full);
  }
  return files;
}

function main(): void {
  const appDir = process.argv[2];
  if (!appDir) {
    send({step: 'error', message: 'Uso: updater-engine <appDir>'});
    process.exit(1);
  }

  const tmpDir = path.join(appDir, 'tmp_updater');
  if (!fs.existsSync(tmpDir)) {
    send({step: 'error', message: `No se encontró tmp_updater en: ${appDir}`});
    process.exit(1);
  }

  // 1. Kill running instances
  send({step: 'kill', message: 'Deteniendo procesos en ejecución...', pct: 5});
  killProcess('clipboard-sync-ui');
  killProcess('clipboard-sync-engine');

  // 2. Copy files
  const SKIP = new Set(['updater.exe', 'app.zip']);
  const allFiles = getAllFiles(tmpDir).filter((f) => !SKIP.has(path.basename(f).toLowerCase()));
  const total = allFiles.length;

  for (let i = 0; i < total; i++) {
    const src = allFiles[i];
    const rel = path.relative(tmpDir, src);
    const dest = path.join(appDir, rel);
    const destParent = path.dirname(dest);
    if (!fs.existsSync(destParent)) fs.mkdirSync(destParent, {recursive: true});
    fs.copyFileSync(src, dest);
    const pct = 10 + Math.round(((i + 1) / total) * 85);
    send({step: 'copy', message: `Copiando ${rel}`, pct});
  }

  send({step: 'done', message: 'Actualización completada.', pct: 100});
}

try {
  main();
} catch (e) {
  send({step: 'error', message: String(e)});
  process.exit(1);
}
