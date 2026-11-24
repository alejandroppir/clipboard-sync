import { commands } from "../rust/bindings.gen";
import { unwrap } from "../rust/result";
import { byId } from "../utils/dom";

/** localStorage key: the tray hint stays hidden once dismissed. */
const TRAY_HINT_DISMISSED = "tray-hint-dismissed";

// Storage can be unavailable: the hint then simply shows again next time.
function initTrayHint(): void {
  const hint = byId("tray-banner");
  try {
    hint.hidden = localStorage.getItem(TRAY_HINT_DISMISSED) === "true";
  } catch {
    hint.hidden = false;
  }
  byId("tray-banner-dismiss").addEventListener("click", () => {
    hint.hidden = true;
    try {
      localStorage.setItem(TRAY_HINT_DISMISSED, "true");
    } catch {
      // See above.
    }
  });
}

/** A switch that runs `save`, and goes back if it fails. */
function initSwitch(id: string, save: (checked: boolean) => ReturnType<typeof commands.setAutostart>): void {
  const toggle = byId<HTMLInputElement>(id);
  toggle.addEventListener("change", async () => {
    toggle.disabled = true;
    try {
      unwrap(await save(toggle.checked));
    } catch {
      // Rust already wrote the reason to the activity log.
      toggle.checked = !toggle.checked;
    } finally {
      toggle.disabled = false;
    }
  });
}

/** Footer buttons, the two switches and the tray hint. */
export function initActions(autostart: boolean): void {
  byId("quit").addEventListener("click", () => void commands.quitApp());
  byId("restart-app").addEventListener("click", () => void commands.restartApp());
  byId("hide").addEventListener("click", () => void commands.closeWindow());
  byId("restart-sync").addEventListener("click", () => void commands.restartSync());
  byId("resume-sync").addEventListener("click", () => void commands.restartSync());
  initSwitch("sync-enabled", commands.setSyncEnabled);
  byId<HTMLInputElement>("autostart").checked = autostart;
  initSwitch("autostart", commands.setAutostart);
  initTrayHint();
}
