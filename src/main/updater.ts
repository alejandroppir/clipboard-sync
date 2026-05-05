import {autoUpdater} from 'electron-updater';
import {BrowserWindow} from 'electron';
import {getSettingsWindow} from './window';

export function initUpdater(onLog: (line: string) => void): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    onLog('[*] Buscando actualizaciones...');
  });

  autoUpdater.on('update-available', (info) => {
    onLog(`[*] Actualización disponible: v${info.version}`);
  });

  autoUpdater.on('update-not-available', () => {
    onLog('[*] La aplicación está actualizada.');
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    onLog(`[*] Descargando actualización... ${pct}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    onLog(`[*] Actualización v${info.version} descargada. Se instalará al cerrar.`);
    const win = getSettingsWindow();
    if (win) {
      win.webContents.send('sync-status', 'running');
    }
  });

  autoUpdater.on('error', (err) => {
    onLog(`[!] Error al actualizar: ${err.message}`);
  });

  // Comprobar al iniciar (sin modal)
  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    // En dev no hay servidor de actualizaciones, ignorar
  });
}
