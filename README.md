# Clipboard Sync

Sincronizador de portapapeles para Windows que mantiene el portapapeles sincronizado entre máquinas usando Firebase Firestore como backend en tiempo real.

Construido con **Electron + TypeScript**. Se distribuye como un único ejecutable portable (`ClipboardSync.exe`), sin instalación.

---

## Cómo funciona

Al arrancar, la aplicación:

1. Se minimiza en la **bandeja del sistema** (system tray)
2. Abre la ventana de configuración automáticamente
3. Si no hay usuario configurado, muestra el diálogo para introducir el `userId` (email)
4. Una vez configurado, inicia la sincronización con Firebase Firestore en tiempo real

Cualquier texto copiado al portapapeles se sube a Firestore. Si otra máquina con el mismo `userId` copia algo, se descarga y se pega en el portapapeles local.

---

## Interfaz

La ventana de configuración muestra:

- **Barra de estado** — indicador visual (verde = activo, gris = detenido, rojo = error) y el `userId` actual
- **Log en tiempo real** — registro de operaciones del sync (subidas, bajadas, errores)
- **Botones de acción**:
  - `Cerrar aplicación` — termina el proceso completamente
  - `Minimizar a la barra de tareas` — oculta la ventana; la app sigue corriendo en el tray
  - `Detener` — pausa la sincronización sin cerrar la app
  - `Reiniciar` — reinicia la sincronización (útil tras cambiar el userId)
- **Botón Cambiar** — permite cambiar el `userId` en cualquier momento

Para volver a abrir la ventana desde el tray: **clic o doble clic** sobre el icono, o clic derecho → _Abrir configuración_.

---

## Estructura del repositorio

```
clipboard-sync-repo/
├── src/
│   ├── main/
│   │   ├── main.ts        # Punto de entrada Electron (single-instance lock, tray, IPC)
│   │   ├── config.ts      # Lectura/escritura de config.json en %LOCALAPPDATA%
│   │   ├── sync.ts        # Motor de sincronización Firebase + clipboard
│   │   ├── tray.ts        # Icono y menú de la bandeja del sistema
│   │   ├── window.ts      # BrowserWindow + handlers IPC
│   │   └── updater.ts     # Auto-actualización con electron-updater
│   ├── preload/
│   │   └── preload.ts     # Bridge seguro entre main y renderer (contextBridge)
│   └── renderer/
│       ├── settings.html  # Interfaz de configuración
│       ├── settings.css   # Estilos dark mode
│       └── renderer.ts    # Lógica del renderer
├── assets/
│   ├── logo.svg           # Fuente del icono
│   └── logo.ico           # Icono generado (usado por Electron y el .exe)
├── dist/                  # Salida de compilación TypeScript (ignorada en git)
├── dist-release/          # Salida de empaquetado electron-builder (ignorada en git)
├── tsconfig.json          # Base TypeScript
├── tsconfig.main.json     # Compilación main + preload (CommonJS)
├── tsconfig.renderer.json # Compilación renderer (ESNext)
├── electron-builder.yml   # Configuración de empaquetado
└── package.json
```

---

## Desarrollo local

### Requisitos

- Node.js 24+
- `npm install`

### Scripts disponibles

| Script                  | Descripción                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`           | Compila TypeScript y lanza la app con Electron                               |
| `npm run build`         | Solo compila TypeScript → `dist/`                                            |
| `npm run package`       | Compila + empaqueta → `dist-release/ClipboardSync.exe` (portable)            |
| `npm run generate-icon` | Convierte `assets/logo.svg` → `assets/logo.ico` (ejecutar al cambiar el SVG) |

### Desarrollo diario

```powershell
npm run dev
```

### Primera ejecución sin config

Si `%LOCALAPPDATA%\clipboard-sync\config.json` no existe, la app abre el diálogo de userId automáticamente al arrancar.

Para simular una primera ejecución limpia:

```powershell
Remove-Item "$env:LOCALAPPDATA\clipboard-sync" -Recurse -Force
npm run dev
```

---

## Empaquetado local

```powershell
npm run package
```

Genera `dist-release/ClipboardSync.exe`. Requiere **Modo de desarrollador de Windows** activado (Configuración → Sistema → Para desarrolladores).

---

## Release / CI

El workflow `.github/workflows/release.yml` se dispara manualmente (`workflow_dispatch`) con un único parámetro:

- `version`: número de versión (ej. `1.2.3`, sin `v`)

El workflow:

1. Hace `npm version $version` y crea el tag en git
2. Compila TypeScript
3. Empaqueta con `electron-builder --win portable --publish always`
4. Publica `ClipboardSync.exe` en GitHub Releases automáticamente

---

## Configuración

El archivo de configuración se guarda en:

```
%LOCALAPPDATA%\clipboard-sync\config.json
```

Contenido:

```json
{"userId": "email@dominio.com"}
```

El `userId` debe coincidir entre todas las máquinas que quieran compartir portapapeles. Solo se usa como clave de documento en Firestore — no hay autenticación Firebase.

---

## Auto-actualización

Cuando la app está empaquetada (`app.isPackaged`), comprueba automáticamente si hay una nueva versión disponible en GitHub Releases al arrancar. Si la hay, descarga e instala la actualización en segundo plano y notifica al usuario.

Al arrancar, la aplicaciÃ³n:

1. Se minimiza en la **bandeja del sistema** (system tray)
2. Abre la ventana de configuraciÃ³n automÃ¡ticamente
3. Si no hay usuario configurado, muestra el diÃ¡logo para introducir el `userId` (email)
4. Una vez configurado, inicia la sincronizaciÃ³n con Firebase Firestore en tiempo real

Cualquier texto copiado al portapapeles se sube a Firestore. Si otra mÃ¡quina con el mismo `userId` copia algo, se descarga y se pega en el portapapeles local.

---

## Interfaz

La ventana de configuraciÃ³n muestra:

- **Barra de estado** â€” indicador visual (verde = activo, gris = detenido, rojo = error) y el `userId` actual
- **Log en tiempo real** â€” registro de operaciones del sync (subidas, bajadas, errores)
- **Botones de acciÃ³n**:
  - `Cerrar aplicaciÃ³n` â€” termina el proceso completamente
  - `Minimizar a la barra de tareas` â€” oculta la ventana; la app sigue corriendo en el tray
  - `Detener` â€” pausa la sincronizaciÃ³n sin cerrar la app
  - `Reiniciar` â€” reinicia la sincronizaciÃ³n (Ãºtil tras cambiar el userId)
- **BotÃ³n Cambiar** â€” permite cambiar el `userId` en cualquier momento

Para volver a abrir la ventana desde el tray: **clic o doble clic** sobre el icono, o clic derecho â†’ _Abrir configuraciÃ³n_.

---

## Estructura del repositorio

```
clipboard-sync-repo/
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ main/
â”‚   â”‚   â”œâ”€â”€ main.ts        # Punto de entrada Electron (single-instance lock, tray, IPC)
â”‚   â”‚   â”œâ”€â”€ config.ts      # Lectura/escritura de config.json en %LOCALAPPDATA%
â”‚   â”‚   â”œâ”€â”€ sync.ts        # Motor de sincronizaciÃ³n Firebase + clipboard
â”‚   â”‚   â”œâ”€â”€ tray.ts        # Icono y menÃº de la bandeja del sistema
â”‚   â”‚   â”œâ”€â”€ window.ts      # BrowserWindow + handlers IPC
â”‚   â”‚   â””â”€â”€ updater.ts     # Auto-actualizaciÃ³n con electron-updater
â”‚   â”œâ”€â”€ preload/
â”‚   â”‚   â””â”€â”€ preload.ts     # Bridge seguro entre main y renderer (contextBridge)
â”‚   â””â”€â”€ renderer/
â”‚       â”œâ”€â”€ settings.html  # Interfaz de configuraciÃ³n
â”‚       â”œâ”€â”€ settings.css   # Estilos dark mode
â”‚       â””â”€â”€ renderer.ts    # LÃ³gica del renderer
â”œâ”€â”€ assets/
â”‚   â”œâ”€â”€ logo.svg           # Fuente del icono
â”‚   â””â”€â”€ logo.ico           # Icono generado (usado por Electron y el .exe)
â”œâ”€â”€ dist/                  # Salida de compilaciÃ³n TypeScript (ignorada en git)
â”œâ”€â”€ dist-release/          # Salida de empaquetado electron-builder (ignorada en git)
â”œâ”€â”€ tsconfig.json          # Base TypeScript
â”œâ”€â”€ tsconfig.main.json     # CompilaciÃ³n main + preload (CommonJS)
â”œâ”€â”€ tsconfig.renderer.json # CompilaciÃ³n renderer (ESNext)
â”œâ”€â”€ electron-builder.yml   # ConfiguraciÃ³n de empaquetado
â””â”€â”€ package.json
```

---

## Desarrollo local

### Requisitos

- Node.js 24+
- `npm install`

### Scripts disponibles

| Script                  | DescripciÃ³n                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`           | Compila TypeScript y lanza la app con Electron                                 |
| `npm run build`         | Solo compila TypeScript â†’ `dist/`                                            |
| `npm run package`       | Compila + empaqueta â†’ `dist-release/ClipboardSync.exe` (portable)            |
| `npm run generate-icon` | Convierte `assets/logo.svg` â†’ `assets/logo.ico` (ejecutar al cambiar el SVG) |

### Desarrollo diario

```powershell
npm run dev
```

### Primera ejecuciÃ³n sin config

Si `%LOCALAPPDATA%\clipboard-sync\config.json` no existe, la app abre el diÃ¡logo de userId automÃ¡ticamente al arrancar.

Para simular una primera ejecuciÃ³n limpia:

```powershell
Remove-Item "$env:LOCALAPPDATA\clipboard-sync" -Recurse -Force
npm run dev
```

---

## Empaquetado local

```powershell
npm run package
```

Genera `dist-release/ClipboardSync.exe`. Requiere **Modo de desarrollador de Windows** activado (ConfiguraciÃ³n â†’ Sistema â†’ Para desarrolladores).

---

## Release / CI

El workflow `.github/workflows/release.yml` se dispara manualmente (`workflow_dispatch`) con un Ãºnico parÃ¡metro:

- `version`: nÃºmero de versiÃ³n (ej. `1.2.3`, sin `v`)

El workflow:

1. Hace `npm version $version` y crea el tag en git
2. Compila TypeScript
3. Empaqueta con `electron-builder --win portable --publish always`
4. Publica `ClipboardSync.exe` en GitHub Releases automÃ¡ticamente

---

## ConfiguraciÃ³n

El archivo de configuraciÃ³n se guarda en:

```
%LOCALAPPDATA%\clipboard-sync\config.json
```

Contenido:

```json
{"userId": "email@dominio.com"}
```

El `userId` debe coincidir entre todas las mÃ¡quinas que quieran compartir portapapeles. Solo se usa como clave de documento en Firestore â€” no hay autenticaciÃ³n Firebase.

---

## Auto-actualizaciÃ³n

Cuando la app estÃ¡ empaquetada (`app.isPackaged`), comprueba automÃ¡ticamente si hay una nueva versiÃ³n disponible en GitHub Releases al arrancar. Si la hay, descarga e instala la actualizaciÃ³n en segundo plano y notifica al usuario.
