import { commands } from "../rust/bindings.gen";
import { unwrap } from "../rust/result";
import { byId, errorMessage, showFieldError } from "../utils/dom";

const dialog = byId<HTMLDialogElement>("encryption-dialog");
const form = byId<HTMLFormElement>("encryption-form");
const password = byId<HTMLInputElement>("encryption-password");
const error = byId("encryption-error");
const save = byId<HTMLButtonElement>("encryption-save");
const remove = byId<HTMLButtonElement>("encryption-remove");

let encrypted = false;

function render(): void {
  byId("encryption-state").textContent = encrypted ? "Activado" : "Desactivado";
  byId("encryption").classList.toggle("setting--on", encrypted);
  byId("encryption-label").textContent = encrypted ? "Contraseña nueva" : "Contraseña";
  save.textContent = encrypted ? "Cambiar" : "Cifrar";
  remove.hidden = !encrypted;
}

function open(): void {
  password.value = "";
  showFieldError(error, "", password);
  dialog.showModal();
}

/** Saves the password, or removes the encryption when it is `null`. */
async function apply(newPassword: string | null): Promise<void> {
  save.disabled = true;
  remove.disabled = true;
  try {
    unwrap(await commands.setEncryptionPassword(newPassword));
    encrypted = newPassword !== null;
    render();
    dialog.close();
  } catch (failure) {
    showFieldError(error, errorMessage(failure), password);
  } finally {
    save.disabled = false;
    remove.disabled = false;
  }
}

export function initEncryptionDialog(initiallyEncrypted: boolean): void {
  encrypted = initiallyEncrypted;
  render();
  byId("encryption").addEventListener("click", open);
  byId("encryption-cancel").addEventListener("click", () => dialog.close());
  remove.addEventListener("click", () => void apply(null));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void apply(password.value);
  });
}
