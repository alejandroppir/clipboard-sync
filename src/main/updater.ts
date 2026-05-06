import {autoUpdater} from 'electron-updater';
import {ipcMain, app} from 'electron';
import {spawn} from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {getSettingsWindow} from './window';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // cada 4 horas

let downloadedFilePath: string | null = null;

function installViaUpdateMode(onLog: (line: string) => void): void {
  if (!downloadedFilePath) {
    onLog('❌ No hay ninguna actualización descargada.');
    return;
  }

  if (!fs.existsSync(downloadedFilePath)) {
    onLog(`❌ El archivo de actualización no existe en disco: ${downloadedFilePath}`);
    return;
  }

  const exeSource = downloadedFilePath;
  // process.execPath apunta al exe extraído en temp, no al portable original.
  // electron-builder inyecta PORTABLE_EXECUTABLE_FILE con la ruta real del exe del usuario.
  const exeTarget = process.env['PORTABLE_EXECUTABLE_FILE'] ?? process.execPath;

  // Copiamos el nuevo exe a un path temporal propio para que actúe como instalador.
  // Ese proceso corre desde su propio %TEMP%, por lo que puede sobrescribir exeTarget libremente.
  const setupExe = path.join(os.tmpdir(), `ClipboardSync-setup-${Date.now()}.exe`);

  try {
    fs.copyFileSync(exeSource, setupExe);
  } catch (err) {
    onLog(`❌ No se pudo preparar el instalador: ${(err as Error).message}`);
    return;
  }

  onLog(`🔄 Lanzando instalador de actualización...`);

  spawn(setupExe, ['--update-mode', '--pid', String(process.pid), '--source', exeSource, '--target', exeTarget], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  app.quit();
}

export function initUpdater(onLog: (line: string) => void): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false; // la instalación la gestiona el proceso instalador

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    downloadedFilePath = ((info as any).downloadedFile as string | null) ?? null;
    onLog(`✅ Actualización v${info.version} descargada. Ruta: ${downloadedFilePath ?? '(no disponible)'}`);
    getSettingsWindow()?.webContents.send('update-ready', info.version);
  });

  autoUpdater.on('error', (err) => {
    // app-update.yml ausente = build sin config de publish (ej: release antigua)
    if (err.message.includes('app-update.yml') || (err.message.includes('ENOENT') && err.message.includes('app-update'))) {
      onLog('⚠️ Auto-actualización no disponible en esta versión.');
      return;
    }
    // latest.yml ausente = release sin artefactos de actualización (ej: primera release incompleta)
    if (err.message.includes('latest.yml') || err.message.includes('Cannot find latest')) {
      onLog('⚠️ No se encontró información de actualizaciones en la release actual.');
      return;
    }
    onLog(`❌ Error al comprobar actualizaciones: ${err.message}`);
  });

  // El usuario confirma la descarga desde la UI
  ipcMain.handle('start-update-download', () => {
    autoUpdater.downloadUpdate().catch((err: Error) => {
      onLog(`❌ Error al descargar la actualización: ${err.message}`);
    });
  });

  // El usuario elige reiniciar ahora — lanza el nuevo exe como instalador y se cierra
  ipcMain.handle('install-update-now', () => {
    installViaUpdateMode(onLog);
  });

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => {
      /* sin servidor en dev */
    });
  };

  check(); // al arrancar — pequeño delay para que el renderer ya esté escuchando
  setInterval(check, CHECK_INTERVAL_MS);
}
