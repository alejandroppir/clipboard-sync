# Clipboard Sync

Sincronizador de portapapeles para Windows que mantiene el portapapeles sincronizado entre máquinas usando Firebase Firestore como backend en tiempo real.

---

## Arquitectura

El proyecto está compuesto por **cinco componentes** independientes. C# solo gestiona la UI; toda la lógica está en TypeScript compilada a `.exe` con `@yao-pkg/pkg`.

```
Usuario
  └─▶ ClipboardSync-Setup.exe  (= launcher.exe, primera vez)
        └─▶ SetupForm           descarga app.zip de GitHub → extrae en AppDir → acceso directo
              └─▶ launcher.exe  (ya en AppDir, ejecuciones normales)
                    └─▶ LaunchingForm  muestra "Iniciando..." mientras...
                          └─▶ launcher-engine.exe  comprueba versión en GitHub
                                ├─▶ { action: "launch" }  → lanza clipboard-sync-ui.exe
                                └─▶ { action: "update" }  → UpdateForm descarga app.zip
                                                                └─▶ updater-engine.exe  copia ficheros
```

### `clipboard-sync-engine` (TypeScript → `.exe`)

El núcleo de la sincronización. Escucha cambios en el portapapeles local y en Firestore, propagando las modificaciones en tiempo real. Se ejecuta como proceso de fondo sin ventana, lanzado y gestionado por la UI.

- Fuente: `src/script.ts`
- Empaquetado con `@yao-pkg/pkg` → `clipboard-sync-engine.exe`
- Config: `%LOCALAPPDATA%\clipboard-sync\config.json`
- Requiere `libs/clipboard_x86_64.exe` en la misma carpeta (embebido en el pkg)

### `clipboard-sync-ui` (C# .NET 9 WinForms)

Interfaz gráfica que gestiona el ciclo de vida del engine. Muestra los logs en tiempo real, estado de conexión y controles para detener/reiniciar.

- Fuente: `sync-ui/`
- Instancia única (Mutex global)
- Icono en bandeja del sistema
- Pide el `userId` la primera vez si no existe config
- Al cerrar la ventana detiene el engine completamente
- Modo **dark** con acento `#2cb232`

### `launcher` (C# .NET 9 WinForms)

Punto de entrada para el usuario. Se distribuye como `ClipboardSync-Setup.exe`.

- Fuente: `launcher/`
- **Primera ejecución** (no está en AppDir): muestra `SetupForm` — descarga `app.zip` de la última GitHub Release, verifica SHA-256, extrae en `%LOCALAPPDATA%\clipboard-sync\`, crea acceso directo en el escritorio, relanza desde AppDir
- **Ejecuciones normales** (ya en AppDir): muestra `LaunchingForm` ("Iniciando...") y en background lanza `launcher-engine.exe`

### `launcher-engine` (TypeScript → `.exe`)

Proceso de vida corta lanzado por el launcher. Comprueba la versión en GitHub y emite una línea JSON por stdout.

- Fuente: `src/launcher-engine.ts`
- Salida: `{ "action": "launch" }` · `{ "action": "update", "version": "...", "appZipUrl": "...", "sha256Url": "..." }` · `{ "action": "error", "message": "..." }`
- Si hay error de red lanza la UI directamente (fail-open)

### `updater-engine` (TypeScript → `.exe`)

Proceso de vida corta lanzado por `UpdateForm` tras descargar y verificar `app.zip`. Hace la copia de ficheros.

- Fuente: `src/updater-engine.ts`
- Recibe `AppDir` como `argv[2]`
- Mata `clipboard-sync-ui` y `clipboard-sync-engine`, copia los ficheros de `tmp_updater/` a AppDir
- Emite líneas JSON de progreso: `{ "step": "kill"|"copy"|"done"|"error", "message": "...", "pct": 0-100 }`

---

## Estructura del repositorio

```
clipboard-sync-repo/
├── src/
│   ├── script.ts              # clipboard-sync-engine (sync con Firebase)
│   ├── launcher-engine.ts     # launcher-engine (comprueba versión GitHub)
│   └── updater-engine.ts      # updater-engine (copia ficheros en actualización)
├── sync-ui/
│   ├── MainForm.cs            # Ventana principal + tray + UserIdDialog
│   ├── SyncEngineManager.cs   # Gestión del proceso engine
│   └── SyncApp.csproj
├── launcher/
│   ├── Program.cs             # Detección setup/normal mode
│   ├── SetupForm.cs           # Primera instalación (descarga app.zip)
│   ├── LaunchingForm.cs       # Pantalla de carga mientras engine comprueba versión
│   ├── UpdateForm.cs          # Descarga + verificación SHA-256 + lanza updater-engine
│   ├── HttpDownloader.cs      # Helper compartido: descarga con progreso + SHA-256
│   └── ClipboardSync.csproj
├── shared/
│   └── DarkTheme.cs           # Dark mode + DWM title bar (compartido entre proyectos C#)
├── scripts/
│   ├── start-local.mjs        # npm run dev  → lanza clipboard-sync-ui directamente
│   ├── stage-local.mjs        # npm run dev:launcher → simula flujo completo con launcher
│   ├── stage-release.mjs      # npm run stage-release → genera ClipboardSync-Setup.exe
│   ├── package-all.mjs        # npm run package → empaqueta los 3 engines TS
│   └── generate-icon.mjs      # npm run generate-icon → SVG → ICO
├── assets/
│   ├── logo.svg               # Fuente del icono (escudo con {A})
│   └── logo.ico               # Icono generado (usado por proyectos C#)
├── libs/
│   └── clipboard_x86_64.exe   # Binario requerido por clipboardy en Windows
├── dist/                      # Salida compilación TS + publish C# (ignorada en git)
├── tsconfig.json
├── package.json
└── version.txt                # Versión actual (ej. 1.0.0)
```

---

## Desarrollo local

### Requisitos

- Node.js 24+
- .NET SDK 9
- `npm install`

### Scripts disponibles

| Script                  | Descripción                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`           | Compila TS, empaqueta engines, compila `sync-ui` (Debug), copia a AppDir y lanza `clipboard-sync-ui.exe` directamente |
| `npm run dev:launcher`  | Igual que `dev` pero publica C# como **self-contained** y lanza `launcher.exe` — simula el flujo real completo        |
| `npm run dev:engine`    | Lanza solo el engine vía `ts-node` (sin UI). Requiere que `config.json` ya exista                                     |
| `npm run build`         | Compila TypeScript → `dist/`                                                                                          |
| `npm run package`       | `build` + empaqueta los 3 engines con `pkg` → `.exe` en la raíz                                                       |
| `npm run stage-release` | Publica launcher como self-contained → `release-staging/ClipboardSync-Setup.exe`                                      |
| `npm run generate-icon` | Convierte `assets/logo.svg` → `assets/logo.ico` (ejecutar al cambiar el SVG)                                          |

### Flujos de desarrollo

**Desarrollo diario de la UI** (arranque rápido):

```powershell
npm run dev
```

**Testear el flujo del launcher** (launcher → version check → lanza UI):

```powershell
npm run dev:launcher
```

**Simular primera instalación limpia**:

```powershell
Remove-Item "$env:LOCALAPPDATA\clipboard-sync" -Recurse -Force
npm run dev:launcher
```

La primera vez pedirá el `userId` (email registrado en Firebase Authentication).

---

## Release / CI

El workflow `.github/workflows/release.yml` se dispara manualmente (`workflow_dispatch`) con:

- `version`: número de versión (ej. `1.2.3`, sin `v`)
- `branch`: rama desde la que construir (por defecto `main`)

Genera y publica en GitHub Releases:

| Artefacto                 | Descripción                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `ClipboardSync-Setup.exe` | El launcher (self-contained). El usuario solo descarga esto                           |
| `app.zip`                 | Todos los ejecutables + `libs/` + `version.txt`. El setup lo descarga automáticamente |
| `app.zip.sha256`          | Hash SHA-256 de `app.zip` para verificación de integridad                             |

### Contenido de `app.zip`

```
launcher.exe
clipboard-sync-ui.exe
clipboard-sync-engine.exe
launcher-engine.exe
updater-engine.exe
libs/
  clipboard_x86_64.exe
version.txt
```

---

## Flujo de usuario final

1. Descarga **`ClipboardSync-Setup.exe`** desde GitHub Releases
2. Doble click → ventana "Descargando Clipboard Sync..." con barra de progreso
3. Se descarga `app.zip` automáticamente, se verifica el hash y se extrae en `%LOCALAPPDATA%\clipboard-sync\`
4. Se crea un acceso directo **"Clipboard Sync"** en el escritorio
5. Se relanza el launcher desde AppDir
6. El launcher comprueba si hay actualizaciones en GitHub
7. Si no hay → lanza `clipboard-sync-ui.exe` directamente
8. Si hay → muestra diálogo de actualización con opción de actualizar o continuar
9. La UI pide el `userId` la primera vez y lo guarda en `config.json`

A partir de ahí el usuario solo usa el acceso directo del escritorio.

---

## Configuración

`%LOCALAPPDATA%\clipboard-sync\config.json`:

```json
{
  "userId": "correo@ejemplo.com"
}
```

El `userId` es el email del usuario registrado en Firebase Authentication. Se usa como identificador del documento en Firestore (`clipboard/{userId}`). Todos los dispositivos del mismo usuario leen/escriben ese documento para sincronizar el portapapeles.
