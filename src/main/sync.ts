import os from 'os';
import crypto from 'crypto';
import {clipboard, app} from 'electron';
import {initializeApp, FirebaseApp} from 'firebase/app';
import {getFirestore, doc, setDoc, getDoc, onSnapshot, collection, getDocs, deleteDoc, Firestore, Unsubscribe} from 'firebase/firestore';
import {format} from 'date-fns';
import {toZonedTime} from 'date-fns-tz';
import {loadConfig} from './config';

const firebaseConfig = {
  apiKey: 'AIzaSyA3ZU5UZIVs-wyNIvTNwV3sOZCMIAbaoK0',
  authDomain: 'test-clipboard-83860.firebaseapp.com',
  projectId: 'test-clipboard-83860',
  storageBucket: 'test-clipboard-83860.appspot.com',
  messagingSenderId: '650219244745',
  appId: '1:650219244745:web:8d3403935c531fbf509118',
};

export type LogCallback = (line: string) => void;
export type StatusCallback = (status: 'running' | 'stopped' | 'error', detail?: string) => void;
export type NotificationCallback = (message: string, isGlobal: boolean) => void;

let firebaseApp: FirebaseApp | null = null;
let db: Firestore | null = null;
let unsubscribe: Unsubscribe | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

let onLog: LogCallback = () => {};
let onStatus: StatusCallback = () => {};
let onNotification: NotificationCallback = () => {};

let unsubGlobalNotif: Unsubscribe | null = null;
let unsubUserNotif: Unsubscribe | null = null;

function log(line: string): void {
  onLog(line);
}

function madridTimestamp(): string {
  return format(toZonedTime(new Date(), 'Europe/Madrid'), 'yyyy/MM/dd-HH:mm:ss');
}

export function setCallbacks(logCb: LogCallback, statusCb: StatusCallback, notifCb?: NotificationCallback): void {
  onLog = logCb;
  onStatus = statusCb;
  if (notifCb) onNotification = notifCb;
}

export function startSync(): void {
  const config = loadConfig();
  if (!config) {
    onStatus('error', 'No hay configuración. Configura tu userId.');
    return;
  }

  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
  }

  const userId = config.userId;
  const machineId = os.hostname();
  log(`✅ Usuario configurado: ${userId}`);
  const docRef = doc(db!, 'clipboard-v2', userId);

  let lastClipboard = '';
  let lastRemote = '';
  let previousError = false;

  async function uploadClipboardIfChanged(): Promise<void> {
    try {
      const current = clipboard.readText();
      if (!current || current.trim() === '') return;
      if (current === lastClipboard || current === lastRemote) return;

      lastClipboard = current;
      await setDoc(docRef, {
        content: current,
        machineId,
        timestamp: madridTimestamp(),
        appVersion: app.getVersion(),
      });
      log('⬆️  Portapapeles subido.');
      previousError = false;
    } catch (err) {
      const error = err as Error;
      if (previousError) return;
      log(`❌ Error al subir: ${error.message}`);
      logAppError(error.stack || error.message);
      previousError = true;
    }
  }

  unsubscribe = onSnapshot(docRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    const remoteContent = data['content'] as string;

    if (typeof remoteContent === 'string' && remoteContent !== lastClipboard && remoteContent !== lastRemote) {
      lastRemote = remoteContent;
      try {
        clipboard.writeText(remoteContent);
        log('⬇️  Portapapeles descargado.');
      } catch (err) {
        const error = err as Error;
        log(`❌ Error en portapapeles: ${error.message}`);
        logAppError(error.stack || error.message);
      }
    }
  });

  unsubGlobalNotif = onSnapshot(doc(db!, 'notifications', 'global'), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data['active'] && data['message']) onNotification(data['message'] as string, true);
  });

  unsubUserNotif = onSnapshot(doc(db!, 'notifications', userId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (!data['read'] && data['message']) onNotification(data['message'] as string, false);
  });

  intervalId = setInterval(() => void uploadClipboardIfChanged(), 1000);

  log(`▶️  Sincronizando para userId="${userId}"`);
  onStatus('running');
}

export function stopSync(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (unsubGlobalNotif) {
    unsubGlobalNotif();
    unsubGlobalNotif = null;
  }
  if (unsubUserNotif) {
    unsubUserNotif();
    unsubUserNotif = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  onStatus('stopped');
  log('⏹️  Sincronización detenida.');
}

export function restartSync(): void {
  stopSync();
  startSync();
}

export function isRunning(): boolean {
  return intervalId !== null;
}

// ── Admin Functions ──
export async function validateAdmin(pass: string): Promise<boolean> {
  if (!db) return false;
  const hash = crypto.createHash('sha256').update(pass).digest('hex');
  try {
    const snap = await getDoc(doc(db, 'admin_config', hash));
    return snap.exists();
  } catch (err) {
    return false;
  }
}

export async function getUsersList(): Promise<any[]> {
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, 'clipboard-v2'));
    return snap.docs.map((d) => ({userId: d.id, ...d.data()}));
  } catch {
    return [];
  }
}

export async function sendAdminNotification(target: string, message: string): Promise<void> {
  if (!db) return;
  if (target === 'global') {
    await setDoc(doc(db, 'notifications', 'global'), {message, active: true, timestamp: Date.now()}, {merge: true});
  } else {
    await setDoc(doc(db, 'notifications', target), {message, read: false, timestamp: Date.now()}, {merge: true});
  }
}

export async function markNotificationRead(userId: string): Promise<void> {
  if (!db) return;
  await setDoc(doc(db, 'notifications', userId), {read: true}, {merge: true});
}

export async function getNotificationsList(): Promise<any[]> {
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, 'notifications'));
    return snap.docs.map((d) => ({id: d.id, ...d.data()}));
  } catch {
    return [];
  }
}

export async function deleteAdminNotification(id: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(db, 'notifications', id));
}

export async function logAppError(trace: string): Promise<void> {
  if (!db) return;
  const config = loadConfig();
  const userId = config ? config.userId : 'unknown';
  const now = new Date();

  const dateStr = format(now, 'yyyy/MM/dd');
  // ID: yyyyMMddHHmmss + string aleatorio
  const idStr = format(now, 'yyyyMMddHHmmss') + '+' + Math.random().toString(36).substring(2, 8);

  try {
    await setDoc(doc(db, 'errors', idStr), {
      userId,
      date: dateStr,
      trace,
    });
  } catch (err) {
    // Falla silenciosamente para no crear un bucle infinito de errores
  }
}
