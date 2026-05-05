# Plan de migración a Electron + TypeScript

## Rama de trabajo

Crear rama `feature/electron` antes de empezar. No tocar `main` hasta que la versión Electron esté probada y lista para release.

```
git checkout -b feature/electron
```

---

## Por qué TypeScript en Electron falla habitualmente — y cómo evitarlo

El problema típico es mezclar ESM con CommonJS o apuntar mal los paths en `electron-builder`. La solución es:

- **Main process**: `CommonJS` (no ESM), `tsc` compila a `dist/main/`
- **Renderer process**: HTML + un script mínimo, sin bundler complejo
- **No Vite, no Webpack** en este proyecto — innecesario para una app de tray sin UI elaborada
- `electron-builder` lee el `dist/` compilado directamente

---

## Fase 1 — Setup del proyecto Electron

### 1.1 Dependencias

```
npm install --save electron electron-updater
npm install --save-dev @electron/rebuild electron-builder @types/electron
```

Mantener: `firebase`, `typescript`, `@types/node`  
Eliminar: `@yao-pkg/pkg`, `ts-node`, `clipboardy` (reemplazado por `electron.clipboard` nativo)

> **Nota:** `@types/electron` está deprecado. El paquete `electron` ya incluye sus propios tipos. No instalar `@types/electron`.

### 1.2 Estructura de carpetas nueva

```
src/
  main/
    main.ts          ← entry point del proceso principal
    tray.ts          ← tray icon + menú contextual
    sync.ts          ← lógica Firebase (de script.ts, adaptada)
    updater.ts       ← electron-updater: check + descarga
    config.ts        ← leer/escribir config.json
    window.ts        ← gestión de la ventana de ajustes
  renderer/
    settings.html    ← ventana de configuración (userId, logs)
    settings.css
    renderer.ts      ← script del renderer (IPC con main)
  preload/
    preload.ts       ← bridge IPC seguro (contextBridge)
```

### 1.3 Dos tsconfig

El `tsconfig.json` actual se convierte en base compartida. Los dos nuevos extienden de él:

- `tsconfig.main.json`: `extends: "./tsconfig.json"`, `module: CommonJS`, `outDir: dist/main`, `types: ["node"]`
- `tsconfig.renderer.json`: `extends: "./tsconfig.json"`, `module: ESNext`, `outDir: dist/renderer`, `lib: ["DOM", "ESNext"]`

### 1.4 Actualizar `package.json`

El campo `"main"` debe apuntar al entry point de Electron:

```json
"main": "dist/main/main.js"
```

Sin esto, `electron .` no encuentra el proceso principal.

---

## Fase 2 — Proceso principal (`main.ts`)

### 2.1 App lifecycle

- `app.whenReady()` → crear tray, iniciar sync
- Sin ventana principal visible al arrancar
- `app.requestSingleInstanceLock()` → instancia única
- **Crítico para tray apps:** sobrescribir el comportamiento por defecto de `window-all-closed`:
  ```ts
  app.on('window-all-closed', (e) => e.preventDefault()); // No salir al cerrar la ventana
  ```
  Sin esto, cerrar la ventana de configuración termina el proceso.

### 2.2 Tray

- Icono desde `assets/logo.ico`
- Menú contextual: Abrir configuración | Reiniciar sync | Salir
- Click en tray → abrir/mostrar ventana de ajustes

### 2.3 IPC channels (main ↔ renderer)

```
'log-line'        main → renderer   nueva línea de log
'sync-status'     main → renderer   estado del engine (activo/detenido/error)
'get-config'      renderer → main   leer config
'set-userid'      renderer → main   guardar userId + reiniciar sync
'restart-sync'    renderer → main   reiniciar engine
'stop-sync'       renderer → main   detener engine
```

---

## Fase 3 — Sync engine (migración de `script.ts`)

`src/main/sync.ts` — casi idéntico al `script.ts` actual con tres cambios:

1. Eliminar el bloque `isPkg` de patcheo de clipboardy — Electron tiene `clipboard` nativo: `import { clipboard } from 'electron'`
2. Eliminar el bloque de instancia única (lo gestiona `app.requestSingleInstanceLock()`)
3. Emitir logs via `EventEmitter` en vez de `console.log` → `main.ts` los reenvía al renderer por IPC

**Resultado:** ~30 líneas eliminadas, el resto igual.

---

## Fase 4 — Auto-update (`updater.ts`)

`electron-updater` en modo portable requiere configuración específica:

```ts
import {autoUpdater} from 'electron-updater';

autoUpdater.forceDevUpdateConfig = false;
// En portable, electron-updater descarga en %LOCALAPPDATA%\clipboard-sync-updater\
// y relanza automáticamente
autoUpdater.checkForUpdatesAndNotify();
```

En `electron-builder.yml`:

```yaml
publish:
  provider: github
  owner: alejandroppir
  repo: clipboard-sync
portable:
  artifactName: ClipboardSync.exe
```

`electron-updater` publica automáticamente `latest.yml` en la release — no hay que mantener `app.zip.sha256` manualmente.

---

## Fase 5 — Ventana de configuración (renderer)

HTML + CSS puro, sin framework:

- Barra de estado: `● Activo` / `○ Detenido` + userId actual + botón Cambiar
- TextArea de logs con scroll automático (igual que el `_logBox` actual)
- Botones Detener / Reiniciar

Dark theme: CSS variables. Forzar modo oscuro independientemente del sistema con:

```ts
nativeTheme.themeSource = 'dark'; // en main.ts, antes de crear ventanas
```

Usar colores idénticos al WinForms: background `#1e1e1e`, surface `#2d2d2d`, texto `#d4d4d4`, acento `#2cb232`.

### Configuración de seguridad del BrowserWindow (obligatorio)

```ts
new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, '../preload/preload.js'),
    contextIsolation: true, // REQUERIDO para contextBridge
    nodeIntegration: false, // NUNCA true en renderer
    sandbox: true,
  },
});
```

Sin `contextIsolation: true` el `contextBridge` no funciona. Con `nodeIntegration: true` la app es vulnerable a XSS/RCE.

### Ruta al HTML desde main process

```ts
win.loadFile(path.join(__dirname, '../renderer/settings.html'));
```

`__dirname` en CommonJS apunta a `dist/main/`, así que `../renderer/` resuelve a `dist/renderer/`.

---

## Fase 6 — electron-builder config

`electron-builder.yml` en la raíz:

```yaml
appId: com.alejandroppir.clipboard-sync
productName: Clipboard Sync
directories:
  output: dist-release
files:
  - dist/main/**
  - dist/preload/**
  - dist/renderer/**
  - assets/logo.ico
win:
  target:
    - target: portable
      arch: x64
  icon: assets/logo.ico
portable:
  artifactName: ClipboardSync.exe
publish:
  provider: github
  owner: alejandroppir
  repo: clipboard-sync
```

> **Atención:** `dist/renderer/**` es obligatorio — sin él, el HTML de la ventana de configuración no se incluye en el exe.

---

## Fase 7 — Scripts npm

| Script            | Descripción                                        |
| ----------------- | -------------------------------------------------- |
| `npm run dev`     | `electron .` con ts compilado en watch             |
| `npm run build`   | Compila ambos tsconfig                             |
| `npm run package` | `electron-builder --win portable`                  |
| `npm run release` | `electron-builder --win portable --publish always` |

---

## Fase 8 — CI/CD (simplificado radicalmente)

El workflow actual de 120 líneas se reduce a:

```yaml
- run: npm ci
- run: npm run build
- run: npm run package # o --publish always para subir directo
```

`electron-builder` genera `ClipboardSync.exe` + `latest.yml` + hash SHA-512 automáticamente y los sube a GitHub Releases si se configura `GH_TOKEN`.

---

## Fase 9 — Eliminar

- `launcher/` (todo el C#)
- `sync-ui/` (todo el C#)
- `shared/`
- `libs/clipboard_x86_64.exe`
- `src/launcher-engine.ts`
- `src/updater-engine.ts`
- `scripts/package-all.mjs`, `stage-local.mjs`, `stage-release.mjs`, `start-local.mjs`
- `version.txt` (la versión la gestiona `package.json` + electron-builder automáticamente)
- `clipboard-sync-engine.exe`, `launcher-engine.exe`, `updater-engine.exe` (binarios en raíz de builds anteriores)
- `PLAN.md` (reemplazado por este plan)

---

## Orden de trabajo recomendado

1. **Fase 1** — Setup: verificar que `electron` arranca en TypeScript
2. **Fase 3** — Sync logic: verificar que Firebase sync funciona dentro de Electron
3. **Fase 2** — Tray + IPC: app funcional sin UI
4. **Fase 5** — Renderer: ventana de configuración
5. **Fase 4** — Updater: probar con una release real
6. **Fase 6+7+8** — Build + CI: pipeline final
7. **Fase 9** — Limpieza del repo
