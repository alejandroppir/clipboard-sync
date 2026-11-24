import { commands, type HistoryEntry } from "../rust/bindings.gen";
import { unwrap } from "../rust/result";
import { byId, errorMessage, flashDone, fromTemplate, initTabs, part } from "../utils/dom";

const list = byId<HTMLOListElement>("history-list");

function toItem(entry: HistoryEntry): HTMLElement {
  const item = fromTemplate("history-item-template");
  part(item, ".history__text").textContent = entry.preview;
  part(item, ".list-item__meta").textContent = `${entry.from ? `De ${entry.from}` : "Copiado aquí"} · ${entry.time}`;
  const copy = part<HTMLButtonElement>(item, '[data-action="copy"]');
  copy.addEventListener("click", async () => {
    try {
      unwrap(await commands.copyFromHistory(entry.id));
      flashDone(copy);
    } catch (failure) {
      copy.title = errorMessage(failure);
    }
  });
  return item;
}

/** Replaces the list; Rust always sends it whole, newest first. */
export function renderHistory(entries: HistoryEntry[]): void {
  list.replaceChildren(...entries.map(toItem));
}

export function initHistory(): void {
  initTabs(["tab-activity", "tab-history"]);
}
