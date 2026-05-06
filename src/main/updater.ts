import {autoUpdater} from 'electron-updater';
import {ipcMain, app} from 'electron';
import {spawn} from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {getSettingsWindow} from './window';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // cada 4 horas

let downloadedFilePath: string | null = null;

function installViaScript(onLog: (line: string) => void): void {
  if (!downloadedFilePath) {
    onLog('❌ No hay ninguna actualización descargada.');
    return;
  }

  const exeSource = downloadedFilePath;
  const exeTarget = process.execPath;
  const batPath = path.join(os.tmpdir(), `clipboard-sync-update-${Date.now()}.bat`);

  // El bat espera a que el proceso muera, copia el nuevo exe, lo relanza y se autoelimine
  const bat = ['@echo off', 'timeout /t 3 /nobreak > nul', `copy /y "${exeSource}" "${exeTarget}"`, `start "" "${exeTarget}"`, `del "%~f0"`].join(
    '\r\n',
  );

  fs.writeFileSync(batPath, bat, {encoding: 'utf8'});

  const child = spawn('cmd.exe', ['/c', batPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  onLog('🔄 Aplicando actualización...');
  app.quit();
}

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    downloadedFilePath = (info as any).downloadedFile ?? null;
    onLog(`✅ Actualización v${info.version} descargada y lista para instalar.`);
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

  // El usuario elige reiniciar ahora — reemplaza el exe portable y relanza
  ipcMain.handle('install-update-now', () => {
    installViaScript(onLog);
  });

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => {
      /* sin servidor en dev */
    });
  };

  check(); // al arrancar — pequeño delay para que el renderer ya esté escuchando
  setInterval(check, CHECK_INTERVAL_MS);
}
