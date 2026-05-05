/**
 * launcher-engine
 *
 * Runs as a short-lived child process spawned by the C# launcher.
 * Prints one JSON line to stdout and exits.
 *
 * Output format (one of):
 *   { "action": "launch" }                        — no update needed, launch UI
 *   { "action": "update", "version": "1.2.3",
 *     "appZipUrl": "...", "sha256Url": "..." }     — update available
 *   { "action": "error", "message": "..." }        — could not check (launch UI anyway)
 *
 * Exit codes:
 *   0 — success (action is launch or update)
 *   1 — unexpected error
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const GH_OWNER = 'alejandroppir';
const GH_REPO = 'clipboard-sync';
const API_URL = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`;

const APP_DIR = path.join(process.env['LOCALAPPDATA'] ?? '', 'clipboard-sync');
const VERSION_PATH = path.join(APP_DIR, 'version.txt');
const UI_PATH = path.join(APP_DIR, 'clipboard-sync-ui.exe');

function send(obj: object): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function isNewer(latest: string, current: string): boolean {
  const parse = (s: string) => s.replace(/^v/, '').split('.').map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return (lc ?? 0) > (cc ?? 0);
}

function httpsGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {'User-Agent': 'clipboard-sync-launcher/1.0'},
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          httpsGet(res.headers.location!, timeoutMs).then(resolve).catch(reject);
          return;
        }
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

async function main(): Promise<void> {
  const uiExists = fs.existsSync(UI_PATH);
  const localVersion = fs.existsSync(VERSION_PATH) ? fs.readFileSync(VERSION_PATH, 'utf8').trim() : '0.0.0';

  let raw: string;
  try {
    raw = await httpsGet(API_URL, 5000);
  } catch (e) {
    if (!uiExists) {
      // Fatal: no UI and no network
      send({action: 'error', message: `No se pudo conectar con el servidor: ${(e as Error).message}`});
    } else {
      // Network error but UI exists — just launch it
      send({action: 'launch'});
    }
    return;
  }

  const data = JSON.parse(raw);
  const tagName: string = data.tag_name ?? '0.0.0';
  let appZipUrl: string | null = null;
  let sha256Url: string | null = null;

  for (const asset of data.assets ?? []) {
    if (asset.name === 'app.zip') appZipUrl = asset.browser_download_url;
    if (asset.name === 'app.zip.sha256') sha256Url = asset.browser_download_url;
  }

  if (!uiExists) {
    // First install — update is mandatory regardless of version
    if (!appZipUrl || !sha256Url) {
      send({action: 'error', message: 'No se encontraron los archivos de descarga en la release.'});
      return;
    }
    send({action: 'update', version: tagName, appZipUrl, sha256Url, isFirstInstall: true});
    return;
  }

  if (isNewer(tagName, localVersion) && appZipUrl && sha256Url) {
    send({action: 'update', version: tagName, appZipUrl, sha256Url, isFirstInstall: false});
  } else {
    send({action: 'launch'});
  }
}

main().catch((e) => {
  send({action: 'error', message: String(e)});
  process.exit(1);
});
