import { commands, type ErrorInfo, GLOBAL_TARGET, type NotificationEntry, type UsageSummary, type UserInfo } from "../rust/bindings.gen";
import { unwrap } from "../rust/result";
import { byId, errorMessage, FEEDBACK_MS, flashDone, fromTemplate, initTabs, part, showFieldError } from "../utils/dom";

/** Clicks on the version, within this time, that open the admin login. */
const OPEN_CLICKS = 3;
const CLICK_WINDOW_MS = 1000;
/** Time to click "delete" a second time to confirm. */
const DELETE_CONFIRM_MS = 3000;

const loginDialog = byId<HTMLDialogElement>("admin-login");
const loginForm = byId<HTMLFormElement>("admin-login-form");
const password = byId<HTMLInputElement>("admin-password");
const loginError = byId("admin-login-error");
const panel = byId<HTMLDialogElement>("admin-panel");
const panelError = byId("admin-error");
const usersList = byId("users-list");
const messagesList = byId("messages-list");
const messageForm = byId<HTMLFormElement>("message-form");
const messageTarget = byId<HTMLInputElement>("message-target");
const messageText = byId<HTMLTextAreaElement>("message-text");
const messageError = byId("message-error");
const messageSave = byId<HTMLButtonElement>("message-save");
const errorsList = byId("errors-list");
const errorsDelete = byId<HTMLButtonElement>("errors-delete");

/** Ids of the errors on screen. */
let errorIds: string[] = [];

function openLogin(): void {
  password.value = "";
  showFieldError(loginError, "", password);
  loginDialog.showModal();
}

async function login(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  try {
    if (!unwrap(await commands.adminLogin(password.value))) {
      showFieldError(loginError, "Contraseña incorrecta.", password);
      return;
    }
    loginDialog.close();
    panel.showModal();
    await refresh();
  } catch (failure) {
    showFieldError(loginError, errorMessage(failure));
  }
}

function usageText(usage: UsageSummary): string {
  const chars = (count: number): string => count.toLocaleString("es-ES");
  return `Caracteres copiados: hoy ${chars(usage.today)} · semana ${chars(usage.week)} · mes ${chars(usage.month)} · total ${chars(usage.total)}`;
}

function userRow(user: UserInfo): HTMLElement {
  const row = fromTemplate("user-row-template");
  part(row, ".avatar").textContent = user.userId.charAt(0);
  part(row, ".list-item__title").textContent = user.userId;
  part(row, ".list-item__meta").textContent = `v${user.appVersion ?? "?"} · ${user.machineId ?? "equipo desconocido"} · Última subida: ${user.lastSeen ?? "—"}`;
  part(row, ".user-row__usage").textContent = usageText(user.usage);
  initCopy(row, user.userId);
  return row;
}

function initCopy(row: HTMLElement, text: string): void {
  const copy = part<HTMLButtonElement>(row, '[data-action="copy"]');
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    flashDone(copy);
  });
}

function messageState(entry: NotificationEntry): { label: string; active: boolean } {
  if (entry.id === GLOBAL_TARGET) {
    return { label: entry.active ? "Activo" : "Inactivo", active: entry.active };
  }
  return { label: entry.read ? "Leído" : "Pendiente", active: !entry.read };
}

function messageRow(entry: NotificationEntry): HTMLElement {
  const row = fromTemplate("message-row-template");
  const state = messageState(entry);
  const chip = part(row, ".chip");
  part(row, ".list-item__name").textContent = entry.id;
  chip.textContent = state.label;
  chip.classList.toggle("chip--accent", state.active);
  part(row, ".list-item__meta").textContent = entry.message;

  part(row, '[data-action="edit"]').addEventListener("click", () => {
    messageTarget.value = entry.id;
    messageText.value = entry.message;
    messageText.focus();
  });

  initDelete(part<HTMLButtonElement>(row, '[data-action="delete"]'), async () => {
    unwrap(await commands.adminDeleteNotification(entry.id));
    await refresh();
  });
  return row;
}

/** The first click only arms the button; a second one within the delay runs `remove`. */
function initDelete(button: HTMLButtonElement, remove: () => Promise<void>): void {
  // An icon button has its text in `aria-label`.
  const attribute = button.ariaLabel === null ? "textContent" : "ariaLabel";
  const label = button[attribute];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = (): void => {
    clearTimeout(timer);
    timer = undefined;
    button.classList.remove("icon-btn--confirm");
    button[attribute] = label;
  };
  button.addEventListener("click", async () => {
    if (timer === undefined) {
      button.classList.add("icon-btn--confirm");
      button[attribute] = "Pulsa otra vez para borrar";
      timer = setTimeout(disarm, DELETE_CONFIRM_MS);
      return;
    }
    disarm();
    button.disabled = true;
    try {
      await remove();
    } catch (failure) {
      showFieldError(panelError, errorMessage(failure));
    } finally {
      button.disabled = false;
    }
  });
}

function errorRow(error: ErrorInfo): HTMLElement {
  const row = fromTemplate("error-row-template");
  const version = error.appVersion ? `v${error.appVersion}` : "versión desconocida";
  part(row, ".list-item__title").textContent = error.userId;
  part(row, ".list-item__meta").textContent = [error.time, version, error.machineId].filter(Boolean).join(" · ");
  part(row, ".error-row__trace").textContent = error.trace;
  initCopy(row, error.trace);
  return row;
}

function fillList(list: HTMLElement, emptyId: string, rows: HTMLElement[]): void {
  list.replaceChildren(...rows);
  byId(emptyId).hidden = rows.length > 0;
}

/** Reads both lists again; a failure is shown in the panel. */
async function refresh(): Promise<void> {
  showFieldError(panelError, "");
  try {
    const [users, messages] = await Promise.all([commands.adminListUsers(), commands.adminListNotifications()]);
    fillList(usersList, "users-empty", unwrap(users).map(userRow));
    fillList(messagesList, "messages-empty", unwrap(messages).map(messageRow));
  } catch (failure) {
    showFieldError(panelError, errorMessage(failure));
  }
}

/** Only when its tab is open: each error is a Firestore read. */
async function refreshErrors(): Promise<void> {
  showFieldError(panelError, "");
  try {
    const errors = unwrap(await commands.adminListErrors());
    errorIds = errors.map((error) => error.id);
    byId("errors-count").textContent = `Últimos errores: ${errors.length}`;
    errorsDelete.hidden = errors.length === 0;
    fillList(errorsList, "errors-empty", errors.map(errorRow));
  } catch (failure) {
    showFieldError(panelError, errorMessage(failure));
  }
}

async function saveMessage(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  messageSave.disabled = true;
  showFieldError(messageError, "");
  try {
    unwrap(await commands.adminSaveNotification(messageTarget.value, messageText.value));
    messageText.value = "";
    messageSave.textContent = "Guardado";
    setTimeout(() => (messageSave.textContent = "Guardar"), FEEDBACK_MS);
    await refresh();
  } catch (failure) {
    showFieldError(messageError, errorMessage(failure));
  } finally {
    messageSave.disabled = false;
  }
}

/** Opens the login after three quick clicks on the version, or with Ctrl+Shift+A. */
function initOpenGesture(): void {
  let clicks = 0;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  byId("app-version").addEventListener("click", () => {
    clicks += 1;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => (clicks = 0), CLICK_WINDOW_MS);
    if (clicks === OPEN_CLICKS) {
      clicks = 0;
      openLogin();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      openLogin();
    }
  });
}

export function initAdminPanel(): void {
  initOpenGesture();
  initTabs(["tab-users", "tab-messages", "tab-errors"]);
  byId("tab-errors").addEventListener("click", () => void refreshErrors());
  byId("errors-refresh").addEventListener("click", () => void refreshErrors());
  initDelete(errorsDelete, async () => {
    unwrap(await commands.adminDeleteErrors(errorIds));
    await refreshErrors();
  });
  loginForm.addEventListener("submit", (event) => void login(event));
  byId("admin-login-cancel").addEventListener("click", () => loginDialog.close());
  byId("admin-close").addEventListener("click", () => panel.close());
  messageForm.addEventListener("submit", (event) => void saveMessage(event));
}
