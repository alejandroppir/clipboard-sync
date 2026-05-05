/**
 * stage-release.mjs
 *
 * Genera el único archivo que un usuario descarga: ClipboardSync-Setup.exe
 * (equivale al artefacto que la CI sube a GitHub Releases).
 *
 * El usuario hace doble click -> SetupForm descarga app.zip desde GitHub -> instala en AppDir.
 *
 * Resultado: release-staging\ClipboardSync-Setup.exe
 *
 * Usage:  npm run stage-release
 */
import {execSync} from 'child_process';
import {copyFileSync, existsSync, mkdirSync, rmSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';

const root    = dirname(dirname(fileURLToPath(import.meta.url)));
const staging = join(root, 'release-staging');

// Kill & clean
for (const name of ['launcher']) {
  try { execSync(`taskkill /F /IM ${name}.exe`, {stdio: 'ignore'}); } catch { /* not running */ }
}
if (existsSync(staging)) rmSync(staging, {recursive: true, force: true});
mkdirSync(staging, {recursive: true});

// Publish launcher in Release mode (self-contained single file)
console.log('[1/2] Publicando launcher (Release, self-contained)...');
execSync(
  'dotnet publish launcher/ClipboardSync.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o dist/launcher',
  {stdio: 'inherit', cwd: root},
);

// Copy as ClipboardSync-Setup.exe
const src  = join(root, 'dist', 'launcher', 'launcher.exe');
const dest = join(staging, 'ClipboardSync-Setup.exe');
copyFileSync(src, dest);

console.log('\n[2/2] Listo!');
console.log(`\n  release-staging\\ClipboardSync-Setup.exe  <- el usuario descarga y ejecuta esto`);
console.log('\n  Para probar first-install limpio:');
console.log('    Remove-Item "$env:LOCALAPPDATA\\clipboard-sync" -Recurse -Force');
console.log(`  Luego doble click en: ${dest}`);
