import fs from 'fs';
import path from 'path';
import os from 'os';
import {spawnSync} from 'child_process';
import clipboardy from 'clipboardy';
import {initializeApp} from 'firebase/app';
import {getFirestore, doc, setDoc, onSnapshot} from 'firebase/firestore';

// process.pkg is injected by @yao-pkg/pkg at runtime
const isPkg = !!(process as unknown as Record<string, unknown>)['pkg'];

// === 1.8 — Single-instance enforcement (only when packaged) ===
if (isPkg && process.platform === 'win32') {
  const exeName = path.basename(process.execPath);
  const selfPid = String(process.pid);
  const tasklist = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
  });
  if (tasklist.status === 0 && tasklist.stdout) {
    const lines = tasklist.stdout.trim().split('\n');
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const pid = parts[1].replace(/"/g, '').trim();
        if (pid !== selfPid) {
          console.log(`[*] Matando instancia anterior (PID ${pid})...`);
          spawnSync('taskkill', ['/PID', pid, '/F'], {encoding: 'utf8'});
        }
      }
    }
  }
}

// === Clipboardy binary path patch (pkg + Windows) ===
if (isPkg && process.platform === 'win32') {
  const binPath = path.join(path.dirname(process.execPath), 'libs', 'clipboard_x86_64.exe');
  process.env['CLIPBOARDY_BINARY_PATH'] = binPath;
  if (!fs.existsSync(binPath)) {
    console.error('No se encontró clipboard_x86_64.exe en:', binPath);
    process.exit(1);
  }

  const clipboardExe = binPath;
  const patchedClipboardy = clipboardy as unknown as {
    readSync: () => string;
    writeSync: (text: string) => void;
  };

  patchedClipboardy.readSync = (): string => {
    const result = spawnSync(clipboardExe, ['--paste'], {encoding: 'utf8'});
    if (result.status !== 0) throw new Error('Error leyendo portapapeles');
    return result.stdout;
  };

  patchedClipboardy.writeSync = (text: string): void => {
    const result = spawnSync(clipboardExe, ['--copy'], {input: text, encoding: 'utf8'});
    if (result.status !== 0) throw new Error('Error escribiendo portapapeles');
  };
}

// === 1.6 — Config path (migrado de ~/.clipboard-sync-config.json) ===
const OLD_CONFIG_PATH = path.join(os.homedir(), '.clipboard-sync-config.json');
const CONFIG_DIR = path.join(process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'), 'clipboard-sync');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

interface Config {
  userId: string;
}

// === 1.7 — Cargar config sin readline-sync ===
function loadConfig(): Config {
  // Migrar desde la ruta antigua si existe y la nueva no
  if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(OLD_CONFIG_PATH)) {
    console.log('[*] Migrando config al nuevo directorio...');
    fs.mkdirSync(CONFIG_DIR, {recursive: true});
    fs.copyFileSync(OLD_CONFIG_PATH, CONFIG_PATH);
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`No se encontró configuración en: ${CONFIG_PATH}`);
    console.error('Por favor, configura tu userId a través de la interfaz de usuario.');
    process.exit(1);
  }

  let config: Config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Config;
  } catch {
    console.error('El archivo de config no es JSON válido.');
    process.exit(1);
    return {userId: ''}; // unreachable, satisfies TS control flow
  }

  if (!config.userId) {
    console.error('El archivo de config no contiene userId.');
    console.error('Por favor, configura tu userId a través de la interfaz de usuario.');
    process.exit(1);
  }

  return config;
}

const machineId = os.hostname();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Clipboard Sync Engine

✔️ Sincroniza el portapapeles local con Firestore.
📦 Requiere: libs/clipboard_x86_64.exe junto al .exe empaquetado (solo en Windows).
`);
    process.exit(0);
  }

  const config = loadConfig();
  const userId = config.userId;

  const firebaseConfig = {
    apiKey: 'AIzaSyA3ZU5UZIVs-wyNIvTNwV3sOZCMIAbaoK0',
    authDomain: 'test-clipboard-83860.firebaseapp.com',
    projectId: 'test-clipboard-83860',
    storageBucket: 'test-clipboard-83860.appspot.com',
    messagingSenderId: '650219244745',
    appId: '1:650219244745:web:8d3403935c531fbf509118',
  };

  const appFirebase = initializeApp(firebaseConfig);
  const db = getFirestore(appFirebase);
  const docRef = doc(db, 'clipboard', userId);

  let lastClipboard = '';
  let lastRemote = '';
  let previousError = false;

  async function uploadClipboardIfChanged(): Promise<void> {
    try {
      const current = clipboardy.readSync();
      if (typeof current !== 'string' || current.trim() === '') return;
      if (current === lastClipboard || current === lastRemote) return;

      lastClipboard = current;
      await setDoc(docRef, {
        content: current,
        machineId: machineId,
        timestamp: Date.now(),
      });
      console.log('[↑] Portapapeles subido.');
      previousError = false;
    } catch (err) {
      const error = err as Error;
      if (error.message && error.message.includes('Could not paste from clipboard')) return;
      if (previousError) return;
      console.error('Error al subir:', error.message);
      previousError = true;
    }
  }

  function listenToFirebaseChanges(): void {
    onSnapshot(docRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      const remoteContent = data['content'] as string;

      if (typeof remoteContent === 'string' && remoteContent !== lastClipboard && remoteContent !== lastRemote) {
        lastRemote = remoteContent;
        try {
          clipboardy.writeSync(remoteContent);
          console.log('[↓] Portapapeles descargado.');
        } catch (err) {
          const error = err as Error;
          console.error('Error en portapapeles:', error.message);
        }
      }
    });
  }

  console.log(`[>>] Sincronizando para userId="${userId}"`);
  listenToFirebaseChanges();
  setInterval(uploadClipboardIfChanged, 1000);
}

main();
