import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setUserId: (userId: string) => ipcRenderer.invoke('set-userid', userId),
  restartSync: () => ipcRenderer.invoke('restart-sync'),
  stopSync: () => ipcRenderer.invoke('stop-sync'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  startUpdateDownload: () => ipcRenderer.invoke('start-update-download'),
  installUpdateNow: () => ipcRenderer.invoke('install-update-now'),

  // Funciones de Admin
  validateAdmin: (pass: string) => ipcRenderer.invoke('validate-admin', pass),
  getUsers: () => ipcRenderer.invoke('get-users'),
  sendNotification: (target: string, msg: string) => ipcRenderer.invoke('send-notification', target, msg),
  markNotificationRead: () => ipcRenderer.invoke('mark-notification-read'),
  getNotifications: () => ipcRenderer.invoke('get-notifications'), // <-- NUEVO
  deleteNotification: (id: string) => ipcRenderer.invoke('delete-notification', id), // <-- NUEVO

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
  onNotification: (callback: (msg: string, isGlobal: boolean) => void) => {
    ipcRenderer.on('app-notification', (_event, msg: string, isGlobal: boolean) => callback(msg, isGlobal));
  },
});
