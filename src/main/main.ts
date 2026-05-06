import {app} from 'electron';
import {createTray} from './tray';
import {registerIpcHandlers, getSettingsWindow, createSettingsWindow} from './window';
import {setCallbacks, startSync} from './sync';
import {initUpdater} from './updater';
import {loadConfig} from './config';
import {runUpdateMode} from './update-mode';

// Modo instalador de actualización — debe comprobarse ANTES del single-instance lock
// para que el proceso helper no falle al adquirirlo mientras el proceso viejo sigue vivo.
if (process.argv.includes('--update-mode')) {
  runUpdateMode();
  // runUpdateMode llama a app.whenReady() internamente; no ejecutar nada más
} else {
  startNormalMode();
}

function startNormalMode(): void {
  // Instancia única
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

  // No salir cuando se cierran todas las ventanas (es una tray app)
  app.on('window-all-closed', () => {
    // intencional: mantener el proceso vivo en la bandeja
  });

  app.whenReady().then(() => {
    // Suprimir la barra de menú por defecto
    app.applicationMenu = null;

    // Conectar callbacks del sync engine
    setCallbacks(broadcastLog, broadcastStatus);

    // Registrar handlers IPC
    registerIpcHandlers(broadcastLog);

    // Crear tray
    createTray(broadcastLog);

    // Abrir ventana de configuración al arrancar; iniciar updater cuando esté lista
    createSettingsWindow(broadcastLog, () => {
      if (app.isPackaged) {
        initUpdater(broadcastLog);
      }
    });

    // Iniciar sync si hay config
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
