import os from 'os';
import {clipboard, app} from 'electron';
import {initializeApp, FirebaseApp} from 'firebase/app';
import {getFirestore, doc, setDoc, onSnapshot, Firestore, Unsubscribe} from 'firebase/firestore';
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

let firebaseApp: FirebaseApp | null = null;
let db: Firestore | null = null;
let unsubscribe: Unsubscribe | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let onLog: LogCallback = () => {};
let onStatus: StatusCallback = () => {};

function log(line: string): void {
  onLog(line);
}

function madridTimestamp(): string {
  return format(toZonedTime(new Date(), 'Europe/Madrid'), 'yyyy/MM/dd-HH:mm:ss');
}

export function setCallbacks(logCb: LogCallback, statusCb: StatusCallback): void {
  onLog = logCb;
  onStatus = statusCb;
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
      }
    }
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
