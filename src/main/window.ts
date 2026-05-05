import path from 'path';
import {BrowserWindow, ipcMain, nativeTheme, app} from 'electron';
import {loadConfig, saveConfig} from './config';
import {restartSync, stopSync, isRunning} from './sync';

let win: BrowserWindow | null = null;

export function createSettingsWindow(onLog: (line: string) => void): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }

  nativeTheme.themeSource = 'dark';

  win = new BrowserWindow({
    width: 640,
    height: 480,
    minWidth: 480,
    minHeight: 360,
    title: 'Clipboard Sync',
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/settings.html'));
  win.setMenuBarVisibility(false);

  win.once('ready-to-show', () => {
    win?.show();
    // Enviar estado actual del sync una vez el renderer esté listo
    const status = isRunning() ? 'running' : 'stopped';
    win?.webContents.send('sync-status', status);
  });

  win.on('closed', () => {
    win = null;
  });
}

export function getSettingsWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

export function registerIpcHandlers(onLog: (line: string) => void): void {
  ipcMain.handle('get-config', () => {
    return loadConfig();
  });

  ipcMain.handle('set-userid', (_event, userId: string) => {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') return;
    saveConfig({userId: userId.trim()});
    onLog(`[*] userId actualizado: ${userId.trim()}`);
    restartSync();
  });

  ipcMain.handle('quit-app', () => {
    stopSync();
    app.quit();
  });

  ipcMain.handle('minimize-to-tray', () => {
    getSettingsWindow()?.hide();
  });

  ipcMain.handle('restart-sync', () => {
    restartSync();
  });

  ipcMain.handle('stop-sync', () => {
    stopSync();
  });
}
