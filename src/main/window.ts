import path from 'path';
import {BrowserWindow, ipcMain, nativeTheme, app} from 'electron';
import {loadConfig, saveConfig} from './config';
import {restartSync, stopSync, isRunning} from './sync';

let win: BrowserWindow | null = null;

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 300,
    height: 200,
    frame: false,
    resizable: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, '../../assets/logo.ico'),
    backgroundColor: '#141414',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  splash.loadFile(path.join(__dirname, '../renderer/splash.html'));
  splash.setMenuBarVisibility(false);
  return splash;
}

function createMainWindow(): BrowserWindow {
  const mainWin = new BrowserWindow({
    width: 640,
    height: 480,
    minWidth: 480,
    minHeight: 360,
    title: 'Clipboard Sync',
    icon: path.join(__dirname, '../../assets/logo.ico'),
    backgroundColor: '#141414',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWin.loadFile(path.join(__dirname, '../renderer/settings.html'));
  mainWin.setMenuBarVisibility(false);
  return mainWin;
}

export function createSettingsWindow(onLog: (line: string) => void, onReady?: () => void): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }

  nativeTheme.themeSource = 'dark';

  const splash = createSplashWindow();
  const SPLASH_MIN_MS = 1500; // mínimo visible aunque la app cargue rápido
  const splashStart = Date.now();

  // Mostrar splash en cuanto esté listo, y cargar la ventana principal en paralelo
  splash.once('ready-to-show', () => splash.show());

  win = createMainWindow();

  win.once('ready-to-show', () => {
    const elapsed = Date.now() - splashStart;
    const delay = Math.max(0, SPLASH_MIN_MS - elapsed);
    setTimeout(() => {
      if (!splash.isDestroyed()) splash.close();
      win?.show();
      const status = isRunning() ? 'running' : 'stopped';
      win?.webContents.send('sync-status', status);
      onReady?.();
    }, delay);
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
