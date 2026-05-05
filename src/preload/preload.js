"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // renderer → main
    getConfig: () => electron_1.ipcRenderer.invoke('get-config'),
    setUserId: (userId) => electron_1.ipcRenderer.invoke('set-userid', userId),
    restartSync: () => electron_1.ipcRenderer.invoke('restart-sync'),
    stopSync: () => electron_1.ipcRenderer.invoke('stop-sync'),
    // main → renderer (suscripciones)
    onLogLine: (callback) => {
        electron_1.ipcRenderer.on('log-line', (_event, line) => callback(line));
    },
    onSyncStatus: (callback) => {
        electron_1.ipcRenderer.on('sync-status', (_event, status, detail) => callback(status, detail));
    },
});
//# sourceMappingURL=preload.js.map