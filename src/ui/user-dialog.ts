import { commands } from "../rust/bindings.gen";
import { unwrap } from "../rust/result";
import { byId, errorMessage, showFieldError } from "../utils/dom";
import { renderUser } from "./status-bar";

const dialog = byId<HTMLDialogElement>("user-dialog");
const form = byId<HTMLFormElement>("user-form");
const input = byId<HTMLInputElement>("user-input");
const error = byId("user-error");

let userId: string | null = null;

/** Opens the dialog with the current id filled in. */
export function openUserDialog(): void {
  input.value = userId ?? "";
  showFieldError(error, "", input);
  dialog.showModal();
  input.select();
}

async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const submit = event.submitter as HTMLButtonElement | null;
  if (submit) {
    submit.disabled = true;
  }
  try {
    const newId = input.value.trim();
    unwrap(await commands.setUserId(newId));
    userId = newId;
    renderUser(userId);
    dialog.close();
  } catch (failure) {
    showFieldError(error, errorMessage(failure), input);
  } finally {
    if (submit) {
      submit.disabled = false;
    }
  }
}

export function initUserDialog(initialUserId: string | null): void {
  userId = initialUserId;
  renderUser(userId);
  form.addEventListener("submit", (event) => void save(event));
  byId("user-cancel").addEventListener("click", () => dialog.close());
  byId("change-user").addEventListener("click", openUserDialog);
}
