import {autoUpdater} from 'electron-updater';
import {ipcMain} from 'electron';
import {getSettingsWindow} from './window';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // cada 4 horas

export function initUpdater(onLog: (line: string) => void): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    onLog('🔍 Comprobando actualizaciones...');
  });

  autoUpdater.on('update-available', (info) => {
    onLog(`🆕 Nueva versión disponible: v${info.version}.`);
    const win = getSettingsWindow();
    if (win && !win.isDestroyed()) {
      // Mostrar en barra de tareas sin traer al frente, luego parpadear
      if (!win.isVisible()) {
        win.showInactive();
      }
      win.flashFrame(true);
      win.webContents.send('update-available', info.version);
    }
  });

  autoUpdater.on('update-not-available', () => {
    onLog('✅ La aplicación está actualizada.');
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    onLog(`📦 Descargando actualización... ${pct}%`);
    getSettingsWindow()?.webContents.send('update-download-progress', pct);
  });

  autoUpdater.on('update-downloaded', (info) => {
    onLog(`✅ Actualización v${info.version} descargada y lista para instalar.`);
    getSettingsWindow()?.webContents.send('update-ready', info.version);
  });

  autoUpdater.on('error', (err) => {
    onLog(`❌ Error al comprobar actualizaciones: ${err.message}`);
  });

  // El usuario confirma la descarga desde la UI
  ipcMain.handle('start-update-download', () => {
    autoUpdater.downloadUpdate().catch((err: Error) => {
      onLog(`❌ Error al descargar la actualización: ${err.message}`);
    });
  });

  // El usuario elige reiniciar ahora
  ipcMain.handle('install-update-now', () => {
    autoUpdater.quitAndInstall();
  });

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => {
      /* sin servidor en dev */
    });
  };

  check(); // al arrancar — pequeño delay para que el renderer ya esté escuchando
  setInterval(check, CHECK_INTERVAL_MS);
}
