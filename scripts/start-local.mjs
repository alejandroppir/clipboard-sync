import {execSync, spawn} from 'child_process';
import {copyFileSync, existsSync, mkdirSync, readdirSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destDir = join(root, 'sync-ui', 'bin', 'Debug', 'net9.0-windows');
const libsSrc = join(root, 'libs');
const libsDest = join(destDir, 'libs');

// Binaries produced by `npm run package`
const binaries = ['clipboard-sync-engine.exe', 'launcher-engine.exe', 'updater-engine.exe'];

// 0. Kill any running instances to free file locks
for (const proc of ['clipboard-sync-ui', 'clipboard-sync-engine']) {
  try {
    execSync(`taskkill /IM "${proc}.exe" /F`, {stdio: 'ignore'});
    console.log(`[0/4] Proceso detenido: ${proc}.exe`);
  } catch {
    // Not running — ignore
  }
}

// 1. Build TypeScript
console.log('[1/4] Compilando TypeScript...');
execSync('npm run build', {stdio: 'inherit', cwd: root});

// 2. Package engines if any exe is missing
const anyMissing = binaries.some((b) => !existsSync(join(root, b)));
if (anyMissing) {
  console.log('[2/4] Empaquetando engines (primera vez, puede tardar)...');
  execSync('npm run package', {stdio: 'inherit', cwd: root});
} else {
  console.log('[2/4] Engines ya empaquetados, omitiendo.');
}

// 3. Build sync-ui
console.log('[3/4] Compilando sync-ui...');
execSync('dotnet build sync-ui\\SyncApp.csproj', {stdio: 'inherit', cwd: root});

// 4. Stage engines + libs next to the sync-ui exe
console.log('[4/4] Copiando archivos al directorio de la UI...');
mkdirSync(libsDest, {recursive: true});
for (const bin of binaries) {
  copyFileSync(join(root, bin), join(destDir, bin));
}
for (const f of readdirSync(libsSrc)) {
  copyFileSync(join(libsSrc, f), join(libsDest, f));
}

// Launch
const uiExe = join(destDir, 'clipboard-sync-ui.exe');
console.log(`\nLanzando: ${uiExe}\n`);
spawn(uiExe, [], {detached: true, stdio: 'ignore'}).unref();

