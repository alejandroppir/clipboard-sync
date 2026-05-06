import {app} from 'electron';
import {spawn} from 'child_process';
import fs from 'fs';
import {createUpdateWindow} from './window';

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

export function runUpdateMode(): void {
  const pidStr = getArg('--pid');
  const source = getArg('--source');
  const target = getArg('--target');

  if (!pidStr || !source || !target) {
    // Argumentos inválidos — salir sin hacer nada
    app.quit();
    return;
  }

  const pid = parseInt(pidStr, 10);

  app.whenReady().then(() => {
    app.applicationMenu = null;
    createUpdateWindow();
    waitForPidAndCopy(pid, source, target);
  });
}

function waitForPidAndCopy(pid: number, source: string, target: string): void {
  const interval = setInterval(() => {
    let alive = true;
    try {
      process.kill(pid, 0); // no mata el proceso, solo comprueba si existe
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
        alive = false;
      }
    }

    if (!alive) {
      clearInterval(interval);
      copyWithRetry(source, target, 3);
    }
  }, 500);
}

function copyWithRetry(source: string, target: string, remaining: number): void {
  try {
    fs.copyFileSync(source, target);
    // Éxito — relanzar la nueva versión desde su ubicación original
    spawn(target, [], {detached: true, stdio: 'ignore'}).unref();
    app.quit();
  } catch {
    if (remaining > 1) {
      setTimeout(() => copyWithRetry(source, target, remaining - 1), 2000);
    } else {
      // Agotados los reintentos — salir igualmente para no quedar colgado
      app.quit();
    }
  }
}
