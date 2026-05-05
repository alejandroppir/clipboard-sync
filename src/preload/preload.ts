import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // renderer → main
  getConfig: () => ipcRenderer.invoke('get-config'),
  setUserId: (userId: string) => ipcRenderer.invoke('set-userid', userId),
  restartSync: () => ipcRenderer.invoke('restart-sync'),
  stopSync: () => ipcRenderer.invoke('stop-sync'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  startUpdateDownload: () => ipcRenderer.invoke('start-update-download'),
  installUpdateNow: () => ipcRenderer.invoke('install-update-now'),

  // main → renderer (suscripciones)
  onLogLine: (callback: (line: string) => void) => {
    ipcRenderer.on('log-line', (_event, line: string) => callback(line));
  },
  onSyncStatus: (callback: (status: 'running' | 'stopped' | 'error', detail?: string) => void) => {
    ipcRenderer.on('sync-status', (_event, status: 'running' | 'stopped' | 'error', detail?: string) => callback(status, detail));
  },
  onUpdateAvailable: (callback: (version: string) => void) => {
    ipcRenderer.on('update-available', (_event, version: string) => callback(version));
  },
  onUpdateDownloadProgress: (callback: (pct: number) => void) => {
    ipcRenderer.on('update-download-progress', (_event, pct: number) => callback(pct));
  },
  onUpdateReady: (callback: (version: string) => void) => {
    ipcRenderer.on('update-ready', (_event, version: string) => callback(version));
  },
});
