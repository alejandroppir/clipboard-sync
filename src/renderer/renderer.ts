// El renderer no tiene acceso a Node. Toda comunicación es via contextBridge.
// window.electronAPI es expuesto por preload.ts

interface ElectronAPI {
  getConfig: () => Promise<{userId: string} | null>;
  setUserId: (userId: string) => Promise<void>;
  restartSync: () => Promise<void>;
  stopSync: () => Promise<void>;
  quitApp: () => Promise<void>;
  minimizeToTray: () => Promise<void>;
  startUpdateDownload: () => Promise<void>;
  installUpdateNow: () => Promise<void>;
  onLogLine: (cb: (line: string) => void) => void;
  onSyncStatus: (cb: (status: 'running' | 'stopped' | 'error', detail?: string) => void) => void;
  onUpdateAvailable: (cb: (version: string) => void) => void;
  onUpdateDownloadProgress: (cb: (pct: number) => void) => void;
  onUpdateReady: (cb: (version: string) => void) => void;
}

// Extender Window en lugar de redeclararlo (evita conflicto con lib.dom.d.ts)
interface Window {
  electronAPI: ElectronAPI;
}

// ── Referencias DOM ──
const statusDot = document.getElementById('status-indicator') as HTMLSpanElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const userIdLabel = document.getElementById('user-id-label') as HTMLSpanElement;
const logBox = document.getElementById('log-box') as HTMLTextAreaElement;
const btnQuit = document.getElementById('btn-quit') as HTMLButtonElement;
const btnMinimize = document.getElementById('btn-minimize') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
const btnChangeUser = document.getElementById('btn-change-user') as HTMLButtonElement;
const dialog = document.getElementById('userid-dialog') as HTMLDivElement;
const userIdInput = document.getElementById('userid-input') as HTMLInputElement;
const dialogOk = document.getElementById('dialog-ok') as HTMLButtonElement;
const dialogCancel = document.getElementById('dialog-cancel') as HTMLButtonElement;
const updateBanner = document.getElementById('update-banner') as HTMLDivElement;
const updateBannerMsg = document.getElementById('update-banner-msg') as HTMLSpanElement;
const updateBannerActions = document.getElementById('update-banner-actions') as HTMLDivElement;
const btnUpdateConfirm = document.getElementById('btn-update-confirm') as HTMLButtonElement;
const btnUpdateDismiss = document.getElementById('btn-update-dismiss') as HTMLButtonElement;
const updatePill = document.getElementById('update-pill') as HTMLSpanElement;

// ── Estado inicial ──
(async () => {
  const config = await window.electronAPI.getConfig();
  if (config?.userId) {
    userIdLabel.textContent = config.userId;
  } else {
    userIdLabel.textContent = '—';
    // Sin userId configurado: mostrar diálogo automáticamente
    userIdInput.value = '';
    dialog.classList.remove('hidden');
    userIdInput.focus();
  }
})();

// ── Suscripciones desde main ──
window.electronAPI.onLogLine((line) => {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  logBox.value += `[${hh}:${mm}:${ss}] ${line}\n`;
  logBox.scrollTop = logBox.scrollHeight;
});

window.electronAPI.onSyncStatus((status, detail) => {
  statusDot.className = `status-dot ${status}`;
  if (status === 'running') {
    statusText.textContent = 'Activo';
  } else if (status === 'stopped') {
    statusText.textContent = 'Detenido';
  } else {
    statusText.textContent = detail ? `Error: ${detail}` : 'Error';
  }
});

// ── Botones ──
btnQuit.addEventListener('click', () => {
  void window.electronAPI.quitApp();
});

btnMinimize.addEventListener('click', () => {
  void window.electronAPI.minimizeToTray();
});

btnStop.addEventListener('click', () => {
  void window.electronAPI.stopSync();
});

btnRestart.addEventListener('click', () => {
  void window.electronAPI.restartSync();
});

// ── Diálogo userId ──
btnChangeUser.addEventListener('click', () => {
  userIdInput.value = userIdLabel.textContent !== '—' ? userIdLabel.textContent! : '';
  dialog.classList.remove('hidden');
  // No hacer focus automático → placeholder visible
});

dialogCancel.addEventListener('click', () => {
  dialog.classList.add('hidden');
});

dialogOk.addEventListener('click', () => {
  const newId = userIdInput.value.trim();
  if (!newId) return;
  void window.electronAPI.setUserId(newId).then(() => {
    userIdLabel.textContent = newId;
    dialog.classList.add('hidden');
  });
});

userIdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') dialogOk.click();
  if (e.key === 'Escape') dialogCancel.click();
});

// ── Actualizaciones ──
type UpdateState = 'idle' | 'available' | 'downloading' | 'ready';
let updateState: UpdateState = 'idle';
let updateVersion = '';

function renderUpdateBanner(): void {
  updateBanner.classList.remove('hidden');
  updatePill.classList.add('hidden');
  updateBannerActions.style.display = '';

  if (updateState === 'available') {
    updateBannerMsg.textContent = `🔔 Nueva versión disponible: v${updateVersion}. ¿Deseas descargarla e instalarla?`;
    btnUpdateConfirm.textContent = 'Actualizar';
    btnUpdateDismiss.textContent = 'Ahora no';
  } else if (updateState === 'ready') {
    updateBannerMsg.textContent = `✅ Versión v${updateVersion} lista para instalar. ¿Deseas reiniciar la aplicación ahora?`;
    btnUpdateConfirm.textContent = 'Reiniciar ahora';
    btnUpdateDismiss.textContent = 'Más tarde';
  }
}

window.electronAPI.onUpdateAvailable((version) => {
  updateState = 'available';
  updateVersion = version;
  renderUpdateBanner();
});

window.electronAPI.onUpdateDownloadProgress((pct) => {
  updateState = 'downloading';
  updateBanner.classList.remove('hidden');
  updatePill.classList.add('hidden');
  updateBannerMsg.textContent = `📦 Descargando actualización... ${pct}%`;
  updateBannerActions.style.display = 'none';
});

window.electronAPI.onUpdateReady((version) => {
  updateState = 'ready';
  updateVersion = version;
  renderUpdateBanner();
});

btnUpdateConfirm.addEventListener('click', () => {
  if (updateState === 'available') {
    updateState = 'downloading';
    updateBannerMsg.textContent = '📦 Iniciando descarga...';
    updateBannerActions.style.display = 'none';
    void window.electronAPI.startUpdateDownload();
  } else if (updateState === 'ready') {
    void window.electronAPI.installUpdateNow();
  }
});

btnUpdateDismiss.addEventListener('click', () => {
  updateBanner.classList.add('hidden');
  if (updateState !== 'idle') {
    updatePill.textContent = `🔔 v${updateVersion}`;
    updatePill.classList.remove('hidden');
  }
});

updatePill.addEventListener('click', () => {
  renderUpdateBanner();
});
