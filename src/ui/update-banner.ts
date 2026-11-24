import { commands, UpdateState, type UpdateStatus } from "../rust/bindings.gen";
import { unwrap } from "../rust/result";
import { byId, errorMessage } from "../utils/dom";
import { showReleaseNotes } from "./release-notes";

const banner = byId("update-banner");
const message = byId("update-message");
const progress = byId<HTMLProgressElement>("update-progress");
const actions = byId("update-actions");
const confirm = byId<HTMLButtonElement>("update-confirm");
const dismiss = byId<HTMLButtonElement>("update-dismiss");
const notes = byId<HTMLButtonElement>("update-notes");
const pill = byId<HTMLButtonElement>("update-pill");
const pillText = byId("update-pill-text");

let status: UpdateStatus = { state: UpdateState.Idle };
/** "Not now" hides the banner until the update moves to another step. */
let dismissed = false;

function describe(current: Exclude<UpdateStatus, { state: typeof UpdateState.Idle }>): { text: string; confirm: string; dismiss: string } {
  switch (current.state) {
    case UpdateState.Available:
      return { text: `Hay una versión nueva: v${current.version}.`, confirm: "Descargar e instalar", dismiss: "Ahora no" };
    case UpdateState.Downloading:
      return { text: `Descargando v${current.version}… ${current.percent}%`, confirm: "", dismiss: "" };
    case UpdateState.Ready:
      return { text: `La versión v${current.version} está lista. Se instalará al reiniciar la aplicación.`, confirm: "Reiniciar ahora", dismiss: "Más tarde" };
    case UpdateState.Failed:
      return { text: `No se pudo descargar v${current.version}: ${current.message}`, confirm: "Reintentar", dismiss: "Cerrar" };
  }
}

function render(): void {
  if (status.state === UpdateState.Idle) {
    banner.hidden = true;
    pill.hidden = true;
    return;
  }
  const view = describe(status);
  banner.hidden = dismissed;
  pill.hidden = !dismissed;
  pillText.textContent = `Actualización v${status.version}`;
  message.textContent = view.text;
  progress.hidden = status.state !== UpdateState.Downloading;
  progress.value = status.state === UpdateState.Downloading ? status.percent : 0;
  actions.hidden = status.state === UpdateState.Downloading;
  notes.hidden = status.state !== UpdateState.Available || status.notes.length === 0;
  confirm.textContent = view.confirm;
  dismiss.textContent = view.dismiss;
}

export function renderUpdate(next: UpdateStatus): void {
  if (next.state !== status.state) {
    dismissed = false;
  }
  status = next;
  render();
}

async function onConfirm(): Promise<void> {
  confirm.disabled = true;
  try {
    unwrap(status.state === UpdateState.Ready ? await commands.installUpdate() : await commands.downloadUpdate());
  } catch (failure) {
    message.textContent = errorMessage(failure);
  } finally {
    confirm.disabled = false;
  }
}

export function initUpdateBanner(): void {
  confirm.addEventListener("click", () => void onConfirm());
  notes.addEventListener("click", () => {
    if (status.state === UpdateState.Available) {
      showReleaseNotes(status.version, status.notes);
    }
  });
  dismiss.addEventListener("click", () => {
    dismissed = true;
    render();
  });
  pill.addEventListener("click", () => {
    dismissed = false;
    render();
  });
}
