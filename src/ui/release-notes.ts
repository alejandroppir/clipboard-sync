import { commands } from "../rust/bindings.gen";
import { byId } from "../utils/dom";

const dialog = byId<HTMLDialogElement>("release-notes");
const title = byId("release-notes-title");
const list = byId<HTMLUListElement>("release-notes-list");

/** Opens the "what's new" dialog for `version`. */
export function showReleaseNotes(version: string, notes: string[]): void {
  title.textContent = `Novedades de la v${version}`;
  list.replaceChildren(
    ...notes.map((note) => {
      const item = document.createElement("li");
      item.textContent = note;
      return item;
    }),
  );
  dialog.showModal();
}

/** Shows this version's notes once, the first time the window opens after an update. */
export async function initReleaseNotes(): Promise<void> {
  byId("release-notes-close").addEventListener("click", () => dialog.close());
  const unseen = await commands.takeReleaseNotes();
  if (unseen) {
    showReleaseNotes(unseen.version, unseen.notes);
  }
}
