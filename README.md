# Clipboard Sync

Sincronizador de portapapeles para Windows que mantiene el portapapeles sincronizado entre máquinas usando Firebase Firestore como backend en tiempo real.

Construido con **Electron + TypeScript**. Se distribuye como un único ejecutable portable (`ClipboardSync.exe`), sin instalación formal.

---

## Cómo instalar

Al ser una aplicación portable, no requiere un proceso de instalación tradicional. Sigue estos pasos:

1. Ve a la sección de **Releases** de este repositorio en GitHub.
2. Descarga el archivo **`ClipboardSync.exe`** de la última versión disponible.
   Si estás en la máquina de abanca y no te deja descargar el .exe, es necesario: - descargar el .custom - cambiarle la extension al fichero por .zip - descomprimir el .zip - continuar con el proceso con normalidad
3. Mueve el archivo a una carpeta permanente en tu disco duro (por ejemplo, `C:\Herramientas\ClipboardSync\`).
4. Haz doble clic en el ejecutable para arrancar la aplicación.

**Recomendación (Arrancar con Windows):**
Para que el portapapeles se sincronice siempre de forma transparente en segundo plano:

1. Presiona `Win + R`, escribe `shell:startup` y presiona **Enter**. Se abrirá la carpeta de Inicio de Windows.
2. Ve a donde guardaste tu `ClipboardSync.exe`, haz clic derecho sobre él y selecciona **Crear acceso directo**.
3. Mueve ese acceso directo recién creado a la carpeta de Inicio.

---

## Cómo funciona

Al arrancar, la aplicación:

1. Se minimiza en la **bandeja del sistema** (system tray).
2. Abre la ventana de configuración automáticamente.
3. Si no hay usuario configurado, muestra el diálogo para introducir el `userId` (email).
4. Una vez configurado, inicia la sincronización con Firebase Firestore en tiempo real.

Cualquier texto copiado al portapapeles se sube a Firestore. Si otra máquina con el mismo `userId` copia algo, se descarga y se pega en el portapapeles local.

---

## Interfaz

La ventana de configuración muestra:

- **Barra de estado** — indicador visual (verde = activo, gris = detenido, rojo = error) y el `userId` actual.
- **Log en tiempo real** — registro de operaciones del sync (subidas, bajadas, errores).
- **Botones de acción**:
  - `Cerrar aplicación` — termina el proceso completamente.
  - `Minimizar a la barra de tareas` — oculta la ventana; la app sigue corriendo en el tray.
  - `Detener` — pausa la sincronización sin cerrar la app.
  - `Reiniciar` — reinicia la sincronización (útil tras cambiar el userId).
- **Botón Cambiar** — permite cambiar el `userId` en cualquier momento.

Para volver a abrir la ventana desde el tray: **clic o doble clic** sobre el icono, o clic derecho → _Abrir configuración_.

---

## Estructura del repositorio

```text
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
4. Publica `ClipboardSync.exe` (y la actualización `.custom`) en GitHub Releases automáticamente.

---

## Configuración

El archivo de configuración se guarda en:

```text
%LOCALAPPDATA%\clipboard-sync\config.json

```

Contenido:

```json
{"userId": "email@dominio.com"}
```

El `userId` debe coincidir entre todas las máquinas que quieran compartir portapapeles. Solo se usa como clave de documento en Firestore — no hay autenticación Firebase.

---

## Auto-actualización

Cuando la app está empaquetada (`app.isPackaged`), comprueba automáticamente si hay una nueva versión disponible en GitHub Releases al arrancar (leyendo el archivo `latest.yml`).

Si la hay, descarga el archivo en segundo plano (`.exe` o `.custom` dependiendo de la versión), lo descomprime internamente si es necesario, y notifica al usuario desde la interfaz para que apruebe el reinicio y la instalación silenciosa.
