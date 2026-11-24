import { commands, events } from "./rust/bindings.gen";
import { appendLog, renderLog } from "./ui/activity-log";
import { initActions } from "./ui/actions";
import { initAdminPanel } from "./ui/admin-panel";
import { initEncryptionDialog } from "./ui/encryption-dialog";
import { initHistory, renderHistory } from "./ui/history";
import { initNotificationBanner, renderNotification } from "./ui/notification-banner";
import { initReleaseNotes } from "./ui/release-notes";
import { renderStatus, renderVersion } from "./ui/status-bar";
import { initUpdateBanner, renderUpdate } from "./ui/update-banner";
import { initUserDialog, openUserDialog } from "./ui/user-dialog";

async function start(): Promise<void> {
  // Listen before reading the snapshot, so no change is missed in between.
  await Promise.all([
    events.logEntry.listen((event) => appendLog(event.payload)),
    events.syncStatus.listen((event) => renderStatus(event.payload)),
    events.notificationChanged.listen((event) => renderNotification(event.payload)),
    events.updateStatus.listen((event) => renderUpdate(event.payload)),
    events.historyChanged.listen((event) => renderHistory(event.payload)),
  ]);
  const snapshot = await commands.getSnapshot();

  renderVersion(snapshot.version);
  renderStatus(snapshot.status);
  renderLog(snapshot.log);
  renderHistory(snapshot.history);
  renderNotification(snapshot.notification);
  renderUpdate(snapshot.update);
  initUserDialog(snapshot.userId);
  initEncryptionDialog(snapshot.encrypted);
  initUpdateBanner();
  initNotificationBanner();
  initActions(snapshot.autostart);
  initAdminPanel();
  initHistory();

  document.body.classList.remove("is-loading");
  if (snapshot.userId === null) {
    openUserDialog();
  } else {
    await initReleaseNotes();
  }
}

void start();
