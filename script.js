const fs = require('fs');
const path = require('path');
const os = require('os');

if (process.pkg && process.platform === 'win32') {
  // Forzar la ruta al exe dentro de la carpeta 'libs' solo en Windows
  process.env.CLIPBOARDY_BINARY_PATH = path.join(path.dirname(process.execPath), 'libs', 'clipboard_x86_64.exe');
  if (!fs.existsSync(process.env.CLIPBOARDY_BINARY_PATH)) {
    console.error('❌ No se encontró clipboard_x86_64.exe en:', process.env.CLIPBOARDY_BINARY_PATH);
    process.exit(1);
  }
}

const clipboardy = require('clipboardy');

// === Parche para que clipboardy use el binario externo en pkg+Windows ===
if (process.pkg && process.platform === 'win32') {
  const child_process = require('child_process');
  const exeDir = path.dirname(process.execPath);
  const clipboardExe = path.join(exeDir, 'libs', 'clipboard_x86_64.exe');

  clipboardy.readSync = () => {
    const result = child_process.spawnSync(clipboardExe, ['--paste'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Error leyendo portapapeles');
    return result.stdout;
  };

  clipboardy.writeSync = (text) => {
    const result = child_process.spawnSync(clipboardExe, ['--copy'], { input: text, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Error escribiendo portapapeles');
  };
}
// =======================================================================

const readlineSync = require('readline-sync');
const CONFIG_PATH = path.join(os.homedir(), '.clipboard-sync-config.json');
console.log('📝 Config path:', CONFIG_PATH);

const machineId = os.hostname();

function getUserId() {
  if (fs.existsSync(CONFIG_PATH)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return config.userId;
  }

  const userId = readlineSync.question('Introduce tu userId para Firebase (ej. correo@externos.abanca.com): ');
  if (!userId) {
    console.error('No se proporcionó userId. Saliendo.');
    process.exit(1);
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ userId }, null, 2));
  return userId;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Clipboard Sync Script – Firebase + Local Clipboard

✔️ Sincroniza el portapapeles local con Firestore.
📦 Requiere: libs/clipboard_x86_64.exe junto al .exe empaquetado (solo en Windows).
`); // Nota: macOS no requiere binario externo.
    process.exit(0);
  }

  const userId = getUserId();

  const { initializeApp } = require('firebase/app');
  const { getFirestore, doc, setDoc, onSnapshot } = require('firebase/firestore');

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

  async function uploadClipboardIfChanged() {
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
      console.log('[↑] Subido a Firebase.');
      previousError = false;
    } catch (err) {
      if (err.message && err.message.includes('Could not paste from clipboard')) return;
      if (previousError) return;
      console.error('❌ Error al subir:', err.message);
      previousError = true;
    }
  }

  function listenToFirebaseChanges() {
    onSnapshot(docRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      const remoteContent = data.content;

      if (typeof remoteContent === 'string' && remoteContent !== lastClipboard && remoteContent !== lastRemote) {
        lastRemote = remoteContent;
        try {
          clipboardy.writeSync(remoteContent);
          console.log('[↓] Copiado desde Firebase.');
        } catch (err) {
          console.error('❌ Error en portapapeles:', err.message);
        }
      }
    });
  }

  console.log(`[🔁] Sincronizando para userId="${userId}"`);
  listenToFirebaseChanges();
  setInterval(uploadClipboardIfChanged, 1000);
}

main();
