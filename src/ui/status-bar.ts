import { SyncState, type SyncStatus } from "../rust/bindings.gen";
import { byId } from "../utils/dom";

const STATUS_TEXT: Record<SyncStatus["state"], string> = {
  [SyncState.Disabled]: "Desactivada",
  [SyncState.Connecting]: "Conectando…",
  [SyncState.Running]: "Sincronizando",
  [SyncState.Paused]: "En pausa",
  [SyncState.Error]: "Error",
};

/** Line under the state: what it means for the user. */
function detailOf(status: SyncStatus): string {
  switch (status.state) {
    case SyncState.Error:
      return status.detail;
    case SyncState.Paused:
      return `Se reanuda sola a las ${status.until}. Lo que copies mientras tanto no se comparte.`;
    case SyncState.Disabled:
      return "Lo que copies no se comparte hasta que la actives.";
    case SyncState.Connecting:
      return "Abriendo la conexión con Firebase.";
    case SyncState.Running:
      return "Lo que copias se comparte con tus otros equipos.";
  }
}

export function renderVersion(version: string): void {
  byId("app-version").textContent = `v${version}`;
}

/** Sync panel: state text, its icon (through `data-state`), what it means, the switch and the buttons. */
export function renderStatus(status: SyncStatus): void {
  byId("sync-panel").dataset.state = status.state;
  const enabled = status.state !== SyncState.Disabled;
  const paused = status.state === SyncState.Paused;
  byId<HTMLInputElement>("sync-enabled").checked = enabled;
  byId("restart-sync").hidden = !enabled || paused;
  byId("resume-sync").hidden = !paused;
  byId("status-text").textContent = STATUS_TEXT[status.state];
  byId("status-detail").textContent = detailOf(status);
}

export function renderUser(userId: string | null): void {
  const label = byId("user-id");
  label.textContent = userId ?? "Sin configurar";
  label.title = userId ?? "";
}
