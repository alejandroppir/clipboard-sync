/**
 * Packages all TypeScript binaries with @yao-pkg/pkg.
 *
 * Outputs (in repo root):
 *   clipboard-sync-engine.exe   — sync engine (launched by sync-ui)
 *   launcher-engine.exe         — version-check engine (launched by launcher)
 *   updater-engine.exe          — file-copy engine (launched by UpdateForm)
 *
 * Note: @yao-pkg/pkg does not support --assets as a CLI flag.
 * Assets are declared in package.json under pkg.assets and only apply to
 * the main entry (dist/script.js). The other two entries have no assets.
 */
import {execSync} from 'child_process';
import {writeFileSync, unlinkSync, existsSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const TARGET = 'node24-win-x64';

// clipboard-sync-engine uses the package.json pkg config (assets declared there)
console.log('\n[pkg] clipboard-sync-engine.exe');
execSync(`npx pkg . --target ${TARGET} -o clipboard-sync-engine`, {stdio: 'inherit', cwd: root});

// launcher-engine and updater-engine have no extra assets — package directly
for (const {entry, output} of [
  {entry: 'dist/launcher-engine.js', output: 'launcher-engine'},
  {entry: 'dist/updater-engine.js', output: 'updater-engine'},
]) {
  // Write a minimal pkg config file for this entry so we can use -c
  const tmpConfig = join(root, `_pkg-tmp-${output}.json`);
  writeFileSync(tmpConfig, JSON.stringify({pkg: {targets: [TARGET]}}));
  console.log(`\n[pkg] ${output}.exe`);
  try {
    execSync(`npx pkg ${entry} --target ${TARGET} -o ${output}`, {stdio: 'inherit', cwd: root});
  } finally {
    if (existsSync(tmpConfig)) unlinkSync(tmpConfig);
  }
}

console.log('\nTodos los binarios empaquetados correctamente.');
