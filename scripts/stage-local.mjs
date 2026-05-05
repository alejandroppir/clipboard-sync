/**
 * stage-local.mjs
 *
 * Simula una instalacion real para desarrollo local:
 *   1. Mata procesos en ejecucion
 *   2. Empaqueta los engines TS con pkg
 *   3. Publica launcher y sync-ui como self-contained single-file (igual que Release)
 *   4. Copia todo a AppDir (%LOCALAPPDATA%\clipboard-sync\)
 *   5. Lanza launcher.exe desde AppDir
 *
 * Usage:  npm run dev:launcher
 */
import {execSync, spawn} from 'child_process';
import {copyFileSync, existsSync, mkdirSync, readdirSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const appDir = join(process.env['LOCALAPPDATA'] ?? '', 'clipboard-sync');

const PUBLISH_FLAGS = '-c Release -r win-x64 --self-contained true -p:PublishSingleFile=true';

// 0. Kill running processes
for (const name of ['clipboard-sync-ui', 'clipboard-sync-engine', 'launcher', 'launcher-engine', 'updater-engine']) {
  try {
    execSync(`taskkill /F /IM ${name}.exe`, {stdio: 'ignore'});
  } catch {
    /* not running */
  }
}
console.log('[0/4] Procesos detenidos.');

// 1. Package TS engines
console.log('[1/4] Empaquetando engines TS...');
execSync('npm run package', {stdio: 'inherit', cwd: root});

// 2. Publish C# projects (self-contained, single exe — no DLLs needed)
console.log('[2/4] Publicando sync-ui...');
execSync(`dotnet publish sync-ui/SyncApp.csproj ${PUBLISH_FLAGS} -o dist/sync-ui`, {stdio: 'inherit', cwd: root});

console.log('[2/4] Publicando launcher...');
execSync(`dotnet publish launcher/ClipboardSync.csproj ${PUBLISH_FLAGS} -o dist/launcher`, {stdio: 'inherit', cwd: root});

// 3. Copy all files to AppDir
console.log('[3/4] Copiando archivos a AppDir...');
mkdirSync(join(appDir, 'libs'), {recursive: true});

for (const [src, dest] of [
  [join(root, 'dist', 'launcher', 'launcher.exe'), join(appDir, 'launcher.exe')],
  [join(root, 'dist', 'sync-ui', 'clipboard-sync-ui.exe'), join(appDir, 'clipboard-sync-ui.exe')],
  [join(root, 'clipboard-sync-engine.exe'), join(appDir, 'clipboard-sync-engine.exe')],
  [join(root, 'launcher-engine.exe'), join(appDir, 'launcher-engine.exe')],
  [join(root, 'updater-engine.exe'), join(appDir, 'updater-engine.exe')],
  [join(root, 'version.txt'), join(appDir, 'version.txt')],
]) {
  if (existsSync(src)) copyFileSync(src, dest);
  else console.warn(`  [WARN] No encontrado: ${src}`);
}

for (const f of readdirSync(join(root, 'libs'))) {
  copyFileSync(join(root, 'libs', f), join(appDir, 'libs', f));
}
console.log(`  -> ${appDir}`);

// 4. Launch
const launcherExe = join(appDir, 'launcher.exe');
console.log(`[4/4] Lanzando: ${launcherExe}`);
spawn(launcherExe, [], {detached: true, stdio: 'ignore'}).unref();
