import { type LogEntry, MAX_LOG_ENTRIES } from "../rust/bindings.gen";
import { byId, fromTemplate, part } from "../utils/dom";

/** Distance from the bottom, in pixels, under which new lines keep the list scrolled down. */
const STICKY_SCROLL_PX = 24;

const list = byId<HTMLOListElement>("log-list");

function toItem(entry: LogEntry): HTMLElement {
  const item = fromTemplate("log-entry-template");
  item.dataset.type = entry.type;
  item.querySelector("use")?.setAttribute("href", `#icon-${entry.type}`);
  part(item, ".log-entry__time").textContent = entry.time;
  part(item, ".log-entry__message").textContent = entry.message;
  return item;
}

function scrollToEnd(): void {
  list.scrollTop = list.scrollHeight;
}

export function renderLog(entries: LogEntry[]): void {
  list.replaceChildren(...entries.map(toItem));
  scrollToEnd();
}

/** Adds a line, following the end of the list unless the user scrolled up to read. */
export function appendLog(entry: LogEntry): void {
  const followEnd = list.scrollHeight - list.scrollTop - list.clientHeight < STICKY_SCROLL_PX;
  list.append(toItem(entry));
  while (list.childElementCount > MAX_LOG_ENTRIES) {
    list.firstElementChild?.remove();
  }
  if (followEnd) {
    scrollToEnd();
  }
}
