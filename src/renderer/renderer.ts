interface ElectronAPI {
  getConfig: () => Promise<{userId: string} | null>;
  setUserId: (userId: string) => Promise<void>;
  restartSync: () => Promise<void>;
  stopSync: () => Promise<void>;
  quitApp: () => Promise<void>;
  minimizeToTray: () => Promise<void>;
  startUpdateDownload: () => Promise<void>;
  installUpdateNow: () => Promise<void>;

  validateAdmin: (pass: string) => Promise<boolean>;
  getUsers: () => Promise<any[]>;
  sendNotification: (target: string, msg: string) => Promise<void>;
  markNotificationRead: () => Promise<void>;
  getNotifications: () => Promise<any[]>;
  deleteNotification: (id: string) => Promise<void>;

  onLogLine: (cb: (line: string) => void) => void;
  onSyncStatus: (cb: (status: 'running' | 'stopped' | 'error', detail?: string) => void) => void;
  onUpdateAvailable: (cb: (version: string) => void) => void;
  onUpdateDownloadProgress: (cb: (pct: number) => void) => void;
  onUpdateReady: (cb: (version: string) => void) => void;
  onNotification: (cb: (msg: string, isGlobal: boolean) => void) => void;
}

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
const trayBanner = document.getElementById('tray-banner') as HTMLDivElement;
const btnTrayBannerDismiss = document.getElementById('btn-tray-banner-dismiss') as HTMLButtonElement;

// ── Banner bandeja ──
btnTrayBannerDismiss.addEventListener('click', () => {
  trayBanner.classList.add('hidden');
});

// ── Estado inicial ──
(async () => {
  const config = await window.electronAPI.getConfig();
  if (config?.userId) {
    userIdLabel.textContent = config.userId;
  } else {
    userIdLabel.textContent = '—';
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

// ── Botones principales ──
btnQuit.addEventListener('click', () => void window.electronAPI.quitApp());
btnMinimize.addEventListener('click', () => void window.electronAPI.minimizeToTray());
btnStop.addEventListener('click', () => void window.electronAPI.stopSync());
btnRestart.addEventListener('click', () => void window.electronAPI.restartSync());

btnChangeUser.addEventListener('click', () => {
  userIdInput.value = userIdLabel.textContent !== '—' ? userIdLabel.textContent! : '';
  dialog.classList.remove('hidden');
});

dialogCancel.addEventListener('click', () => dialog.classList.add('hidden'));
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

updatePill.addEventListener('click', () => renderUpdateBanner());

// ── Easter Egg Admin (3 clics) ──
const statusBar = document.querySelector('.status-bar') as HTMLDivElement;
let clickCount = 0;
let clickTimer: ReturnType<typeof setTimeout> | null = null;

statusBar.addEventListener('click', () => {
  clickCount++;
  if (clickCount === 1) {
    clickTimer = setTimeout(() => {
      clickCount = 0;
    }, 1000);
  } else if (clickCount === 3) {
    if (clickTimer) clearTimeout(clickTimer);
    clickCount = 0;
    const adminPassInput = document.getElementById('admin-pass') as HTMLInputElement;
    adminPassInput.value = '';
    adminPassInput.style.borderColor = 'var(--border)';
    document.getElementById('admin-dialog')!.classList.remove('hidden');
    adminPassInput.focus();
  }
});

const adminDialog = document.getElementById('admin-dialog') as HTMLDivElement;
const adminPanel = document.getElementById('admin-panel') as HTMLDivElement;
const adminPassInput = document.getElementById('admin-pass') as HTMLInputElement;

document.getElementById('admin-cancel')!.addEventListener('click', () => adminDialog.classList.add('hidden'));

adminPassInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('admin-ok')!.click();
  if (e.key === 'Escape') document.getElementById('admin-cancel')!.click();
});

// ── Lógica de Pestañas (Tabs) ──
const tabBtns = document.querySelectorAll('.admin-tab-btn');
const tabContents = document.querySelectorAll('.admin-tab-content');

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabBtns.forEach((b) => b.classList.remove('active'));
    tabContents.forEach((c) => c.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(btn.getAttribute('data-target')!)!.classList.add('active');
  });
});

// ── Cargar Datos del Admin ──
async function loadAdminData() {
  // 1. Cargar usuarios
  const users = await window.electronAPI.getUsers();
  const listDiv = document.getElementById('admin-users-list')!;
  listDiv.innerHTML = users
    .map(
      (u: any) => `
    <div class="admin-list-item">
      <div>
        <b style="color: var(--text);">${u.userId}</b>
        <div style="color: var(--text-dim); font-size: 11px; margin-top: 2px;">
          v${u.appVersion || '?'} | Última conexión: ${u.timestamp || '?'}
        </div>
      </div>
      <button class="icon-btn copy copy-user" data-id="${u.userId}" title="Copiar ID">
        <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
      </button>
    </div>
  `,
    )
    .join('');

  // 2. Cargar notificaciones
  const notifs = await window.electronAPI.getNotifications();
  const notifsDiv = document.getElementById('admin-notifs-list')!;
  notifsDiv.innerHTML = notifs
    .map(
      (n: any) => `
    <div class="admin-list-item" data-id="${n.id}" data-msg="${n.message}">
      <div style="padding-right: 10px;">
        <b style="color: var(--text);">${n.id}</b>
        <span style="color: var(--accent); font-size: 11px;">${n.read ? ' (Leída)' : ''}</span>
        <div style="color: var(--text-muted); margin-top: 2px;">${n.message}</div>
      </div>
      <div style="display: flex; gap: 2px;">
        <button class="icon-btn edit edit-notif" title="Editar">
          <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button class="icon-btn delete delete-notif" title="Borrar">
          <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    </div>
  `,
    )
    .join('');
}

// ── Eventos del Admin Panel ──
document.getElementById('admin-ok')!.addEventListener('click', async () => {
  const isValid = await window.electronAPI.validateAdmin(adminPassInput.value);
  if (isValid) {
    adminDialog.classList.add('hidden');
    adminPanel.classList.remove('hidden');
    loadAdminData();
  } else {
    adminPassInput.style.borderColor = 'var(--error)';
  }
});

document.getElementById('btn-admin-close')!.addEventListener('click', () => adminPanel.classList.add('hidden'));

// Copiar ID de Usuario
document.getElementById('admin-users-list')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.copy-user') as HTMLButtonElement;
  if (btn) {
    const id = btn.getAttribute('data-id');
    if (id) {
      navigator.clipboard.writeText(id);
      const svg = btn.querySelector('svg')!;
      svg.style.fill = 'var(--accent)';
      setTimeout(() => (svg.style.fill = 'currentColor'), 1000);
    }
  }
});

// Editar y Borrar Notificaciones
document.getElementById('admin-notifs-list')!.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('.icon-btn') as HTMLButtonElement | null;
  if (!btn) return;

  const parent = btn.closest('.admin-list-item') as HTMLElement;
  const id = parent.getAttribute('data-id')!;

  if (btn.classList.contains('delete-notif')) {
    // 🔥 Confirmación inline sin usar confirm() nativo 🔥
    if (btn.getAttribute('data-confirm') === 'true') {
      btn.innerHTML = '⏳';
      await window.electronAPI.deleteNotification(id);
      loadAdminData();
    } else {
      btn.setAttribute('data-confirm', 'true');
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<span style="font-size: 11px; font-weight: bold; padding: 0 4px;">¿Seguro?</span>';
      btn.style.color = 'var(--error)';

      setTimeout(() => {
        if (document.body.contains(btn)) {
          btn.removeAttribute('data-confirm');
          btn.innerHTML = originalHtml;
          btn.style.color = '';
        }
      }, 3000); // Tienes 3 segundos para confirmar el borrado
    }
  } else if (btn.classList.contains('edit-notif')) {
    const oldMsg = parent.getAttribute('data-msg')!;
    (document.getElementById('admin-notif-target') as HTMLInputElement).value = id;
    (document.getElementById('admin-notif-msg') as HTMLInputElement).value = oldMsg;
    document.getElementById('admin-notif-msg')!.focus();
  }
});

// Guardar nueva notificación
document.getElementById('btn-admin-send')!.addEventListener('click', async (e) => {
  const btn = e.target as HTMLButtonElement;
  const targetInput = document.getElementById('admin-notif-target') as HTMLInputElement;
  const msgInput = document.getElementById('admin-notif-msg') as HTMLInputElement;
  const target = targetInput.value.trim();
  const msg = msgInput.value.trim();

  if (target && msg) {
    const originalText = btn.textContent;
    btn.textContent = 'Guardando...';

    await window.electronAPI.sendNotification(target, msg);

    // 🔥 Feedback visual sin usar alert() nativo 🔥
    btn.textContent = '¡Guardado!';
    btn.classList.replace('btn-accent', 'btn-secondary');
    msgInput.value = '';
    loadAdminData();

    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.replace('btn-secondary', 'btn-accent');
    }, 2000);
  }
});

// ── Notificaciones Recibidas (Usuario final) ──
const notifBanner = document.getElementById('notif-banner') as HTMLDivElement;
const notifBannerMsg = document.getElementById('notif-banner-msg') as HTMLSpanElement;
let isCurrentNotifGlobal = false;

window.electronAPI.onNotification((msg, isGlobal) => {
  notifBannerMsg.textContent = msg;
  notifBanner.classList.remove('hidden');
  isCurrentNotifGlobal = isGlobal;
});

document.getElementById('btn-notif-dismiss')!.addEventListener('click', () => {
  notifBanner.classList.add('hidden');
  if (!isCurrentNotifGlobal) {
    void window.electronAPI.markNotificationRead();
  }
});
