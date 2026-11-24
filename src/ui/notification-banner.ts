import { commands, type Notification } from "../rust/bindings.gen";
import { byId } from "../utils/dom";

const banner = byId("notification-banner");
const message = byId("notification-message");

/** Shows the admin's message, or hides the banner when there is none. */
export function renderNotification(notification: Notification | null): void {
  banner.hidden = notification === null;
  message.textContent = notification?.message ?? "";
}

export function initNotificationBanner(): void {
  // Rust hides it and sends the change back, so the banner is updated through `renderNotification`.
  byId("notification-dismiss").addEventListener("click", () => void commands.dismissNotification());
}
