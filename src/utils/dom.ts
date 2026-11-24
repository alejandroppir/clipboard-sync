/** How long a "done" mark stays. */
export const FEEDBACK_MS = 1500;

/** Element by id. A missing element is a bug in the page (`index.html` or a `html/` partial), so it throws. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

/** Descendant of `root` matching `selector`; throws when the template does not have it. */
export function part<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element ${selector}`);
  }
  return element;
}

/** New copy of the element inside a `<template>`. */
export function fromTemplate(id: string): HTMLElement {
  const element = byId<HTMLTemplateElement>(id).content.firstElementChild;
  if (!element) {
    throw new Error(`Empty template #${id}`);
  }
  return element.cloneNode(true) as HTMLElement;
}

/** Shows `message` under a form field, or hides it when empty. `input`, if given, is marked invalid while it shows. */
export function showFieldError(element: HTMLElement, message: string, input?: HTMLElement): void {
  element.textContent = message;
  element.hidden = message === "";
  if (input) {
    input.ariaInvalid = message === "" ? null : "true";
  }
}

/** Tabs given by id: each one shows the panel named in its `aria-controls` and hides the others. */
export function initTabs(ids: string[]): void {
  const tabs = ids.map((id) => byId(id));
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      for (const other of tabs) {
        const selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        byId(other.getAttribute("aria-controls") ?? "").hidden = !selected;
      }
    });
  }
}

/** Marks an icon button as done for a moment. */
export function flashDone(button: HTMLElement): void {
  button.classList.add("icon-btn--done");
  setTimeout(() => button.classList.remove("icon-btn--done"), FEEDBACK_MS);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
