import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // renderer → main
  getConfig: () => ipcRenderer.invoke('get-config'),
  setUserId: (userId: string) => ipcRenderer.invoke('set-userid', userId),
  restartSync: () => ipcRenderer.invoke('restart-sync'),
  stopSync: () => ipcRenderer.invoke('stop-sync'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),

  // main → renderer (suscripciones)
  onLogLine: (callback: (line: string) => void) => {
    ipcRenderer.on('log-line', (_event, line: string) => callback(line));
  },
  onSyncStatus: (callback: (status: 'running' | 'stopped' | 'error', detail?: string) => void) => {
    ipcRenderer.on('sync-status', (_event, status: 'running' | 'stopped' | 'error', detail?: string) => callback(status, detail));
  },
});
