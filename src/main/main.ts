import {app} from 'electron';
import {createTray} from './tray';
import {registerIpcHandlers, getSettingsWindow, createSettingsWindow} from './window';
import {setCallbacks, startSync} from './sync';
import {initUpdater} from './updater';
import {loadConfig} from './config';
import {runUpdateMode} from './update-mode';

if (process.argv.includes('--update-mode')) {
  runUpdateMode();
} else {
  startNormalMode();
}

function startNormalMode(): void {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    process.exit(0);
  }

  app.on('second-instance', () => {
    const win = getSettingsWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    } else {
      createSettingsWindow(broadcastLog);
    }
  });

  app.on('window-all-closed', () => {});

  app.whenReady().then(() => {
    app.applicationMenu = null;

    setCallbacks(broadcastLog, broadcastStatus, (msg: string, isGlobal: boolean) => {
      const win = getSettingsWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('app-notification', msg, isGlobal);
      }
    });

    registerIpcHandlers(broadcastLog);
    createTray(broadcastLog);

    createSettingsWindow(broadcastLog, () => {
      if (app.isPackaged) {
        initUpdater(broadcastLog);
      }
    });

    const config = loadConfig();
    if (config) {
      startSync();
    } else {
      broadcastLog('⚠️  No hay configuración. Abre la configuración para empezar.');
    }
  });
}

function broadcastLog(line: string): void {
  const win = getSettingsWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('log-line', line);
  }
}

function broadcastStatus(status: 'running' | 'stopped' | 'error', detail?: string): void {
  const win = getSettingsWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('sync-status', status, detail);
  }
}
