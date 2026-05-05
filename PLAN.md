# Clipboard Sync — Plan de Implementación

## Índice

1. [Visión general](#visión-general)
2. [Requisitos del proyecto](#requisitos-del-proyecto)
3. [Preferencias técnicas](#preferencias-técnicas)
4. [Arquitectura final](#arquitectura-final)
5. [Estructura de repositorio objetivo](#estructura-de-repositorio-objetivo)
6. [Estructura de releases en GitHub](#estructura-de-releases-en-github)
7. [Plan paso a paso](#plan-paso-a-paso)

---

## Visión general

App portable de sincronización de portapapeles multiplataforma (Windows / macOS) con sistema de auto-actualización. El usuario solo interactúa con un único `.exe` (Windows) o binario (macOS). Los archivos internos se gestionan en `LocalAppData` (Windows) o `~/Library/Application Support` (macOS) sin que el usuario los vea.

La lógica de sincronización (Node/TypeScript, empaquetada con `pkg`) se ejecuta como proceso en segundo plano sin ventana de terminal. Una aplicación C# separada actúa como interfaz principal: muestra en tiempo real los mensajes del proceso de sincronización, permite pararlo y relanzarlo, y garantiza que solo exista una instancia del engine activa en cada momento.

---

## Requisitos del proyecto

### Requisitos funcionales

- **RF-01** — El usuario descarga un único ejecutable (`ClipboardSync.exe` en Windows).
- **RF-02** — En la primera ejecución, el launcher se copia a `%LOCALAPPDATA%\clipboard-sync\`, crea un acceso directo en el escritorio y arranca normalmente.
- **RF-03** — En cada arranque, el launcher comprueba si existe una nueva release en GitHub.
- **RF-04** — Si hay nueva versión, se muestra un diálogo con la opción de actualizar o continuar (avisando que si se continua no tendrá las ultimas funcionalidades y que puede dejar de funcionar en algun momento).
  - Botón **Continuar** — lanza la app sin actualizar.
  - Botón **Actualizar** (color accent `#2cb232`) — descarga la nueva versión.
- **RF-05** — Si no hay nueva versión, la app arranca directamente sin mostrar diálogo.
- **RF-06** — La descarga se realiza en una carpeta temporal `%LOCALAPPDATA%\clipboard-sync\tmp_updater\`.
- **RF-07** — Antes de aplicar la actualización se verifica el SHA-256 del `app.zip` descargado contra `app.zip.sha256` de la release. Si no coincide, se aborta y se avisa al usuario.
- **RF-08** — El proceso de actualización cierra la app principal, lanza `updater.exe` desde `tmp_updater`, que sobreescribe los archivos, elimina `tmp_updater` (mediante `.bat` temporal) y relanza `launcher.exe` (tener cuidado de que el bat temporal espere a que updater.exe haya finalizado).
- **RF-09** — La sincronización del portapapeles funciona igual que en la versión actual (Firebase + `clipboardy`), ejecutada como proceso `clipboard-sync-engine.exe` en segundo plano.
- **RF-10** — El `userId` se persiste en `%LOCALAPPDATA%\clipboard-sync\config.json` (migrado desde `~/.clipboard-sync-config.json`).
- **RF-11** — El proceso `clipboard-sync-engine.exe` se lanza siempre sin ventana de consola visible (modo background).
- **RF-12** — Al iniciarse, `clipboard-sync-engine.exe` busca otras instancias de sí mismo en ejecución y las termina antes de continuar (garantía de instancia única del engine).
- **RF-13** — La aplicación principal C# (`clipboard-sync-ui.exe`) captura `stdout` y `stderr` de `clipboard-sync-engine.exe` y los muestra en tiempo real en su interfaz.
- **RF-14** — La aplicación principal C# expone controles para **detener** y **relanzar** el engine sin cerrar la propia UI.
- **RF-15** — Si `clipboard-sync-engine.exe` termina inesperadamente (crash), la UI lo detecta, muestra el error y ofrece la opción de reiniciarlo.
- **RF-16** — Solo puede haber una instancia de `clipboard-sync-ui.exe` activa. Si el usuario intenta abrirla por segunda vez, la instancia ya existente se pone en primer plano.

### Requisitos no funcionales

- **RNF-01** — La app es **portable**: no requiere instalación, no escribe en el registro de Windows.
- **RNF-02** — El launcher no depende de Node.js ni de ningún runtime externo en el equipo del usuario (los proyectos C# se publican como self-contained).
- **RNF-03** — El ejecutable principal (`clipboard-sync-engine.exe`) embute Node mediante `@yao-pkg/pkg`.
- **RNF-04** — El launcher C# debe ser lo más ligero y estable posible (lógica mínima), ya que no se auto-actualiza por sí solo — solo descarga y delega.
- **RNF-05** — Todo el código de negocio (sincronización) se escribe en **TypeScript**, transpilado a JS antes de empaquetar con `pkg`.
- **RNF-06** — El peso total del paquete distribuible debe ser menor que una solución Electron equivalente.
- **RNF-07** — Debe estar bien modularizado y diferenciado el proceso de actualización de la app de sincronizar el portapapeles. Si en un futuro quiere replicarse el proceso para otra aplicacion habría que copiar todos los ficheros salvo el de la funcionalidad principal.
- **RNF-08** — La comunicación entre `clipboard-sync-ui.exe` y `clipboard-sync-engine.exe` se realiza exclusivamente mediante `stdout`/`stderr` del proceso hijo. No se requiere IPC adicional.
- **RNF-09** — El engine nunca interactúa directamente con el usuario (no lee `stdin`, no muestra ventanas). Toda interacción de usuario pasa por la UI C#.

---

## Preferencias técnicas

| Ámbito                            | Elección                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lógica de sincronización          | **TypeScript** (transpilado a JS, luego empaquetado con `@yao-pkg/pkg`)                                                                                                                                                                                            |
| UI principal / Launcher / Updater | **C# (.NET 9, `net9.0-windows`)** — WinForms; publicado como **self-contained single file** (`--self-contained true -p:PublishSingleFile=true`), lo que embute el runtime .NET en el propio `.exe` y no requiere ningún runtime instalado en el equipo del usuario |
| Empaquetado Node                  | **`@yao-pkg/pkg`** (fork mantenido de `pkg` de Vercel, compatible con Node 24; instalado como devDependency)                                                                                                                                                       |
| CI/CD y releases                  | **GitHub Actions** + **GitHub Releases**                                                                                                                                                                                                                           |
| Verificación de integridad        | SHA-256 del `app.zip`                                                                                                                                                                                                                                              |
| Config usuario                    | `%LOCALAPPDATA%\clipboard-sync\config.json`                                                                                                                                                                                                                        |
| Color accent                      | `#2cb232`                                                                                                                                                                                                                                                          |
| PowerShell                        | Sí (no CMD) para scripts de desarrollo                                                                                                                                                                                                                             |

---

## Arquitectura final

```
[Usuario]
    │
    ▼
ClipboardSync.exe  ←  único archivo que ve/descarga el usuario
    │
    │  Primera ejecución (no está en LocalAppData)
    ├──────────────────────────────────────────────────────────────►
    │   1. Se copia a %LOCALAPPDATA%\clipboard-sync\launcher.exe
    │   2. Crea acceso directo en el escritorio
    │   3. Relanza desde LocalAppData y se cierra
    │
    │  Ejecuciones normales (ya está en LocalAppData)
    ├──────────────────────────────────────────────────────────────►
    │   1. Consulta GitHub Releases API → compara versión
    │   │
    │   ├── Sin cambios → lanza clipboard-sync-ui.exe directamente
    │   │
    │   └── Nueva versión disponible → muestra diálogo
    │           │
    │           ├── [Continuar] → lanza clipboard-sync-ui.exe
    │           │
    │           └── [Actualizar]
    │                   │
    │                   ▼
    │           Descarga app.zip + app.zip.sha256 → tmp_updater\
    │           Verifica SHA-256
    │           Extrae app.zip → tmp_updater\
    │           Lanza tmp_updater\updater.exe
    │           Se cierra
    │                   │
    │                   ▼
    │           updater.exe
    │           Muestra "Actualizando..."
    │           Sobreescribe archivos en LocalAppData
    │           Lanza .bat temporal que elimina tmp_updater\ y relanza launcher.exe
    │           Se cierra
    │
    ▼
clipboard-sync-ui.exe  ←  aplicación principal C# (ventana/tray)
    │
    │   1. Garantiza instancia única (mutex global)
    │   2. Lanza clipboard-sync-engine.exe en background (sin consola)
    │   3. Captura stdout/stderr y los muestra en la UI
    │   4. Botones: [Detener] / [Reiniciar]
    │   5. Si el engine cae inesperadamente → muestra error + [Reiniciar]
    │
    ▼
clipboard-sync-engine.exe  ←  pkg (Node embebido + script.ts compilado)
    │
    │   1. Al arrancar: busca y mata instancias previas de sí mismo
    │   2. Sincroniza portapapeles con Firebase (sin ventana, sin stdin)
    │   3. Emite logs por stdout/stderr (los captura clipboard-sync-ui.exe)
    │
    ▼
%LOCALAPPDATA%\clipboard-sync\
    ├── launcher.exe               ← C# bootstrap (acceso directo del escritorio)
    ├── clipboard-sync-ui.exe      ← C# app principal (UI + gestión del engine)
    ├── clipboard-sync-engine.exe  ← pkg (Node embebido + script.ts compilado)
    ├── libs\
    │   └── clipboard_x86_64.exe
    ├── version.txt
    └── config.json                ← userId persistido
```

---

## Estructura de repositorio objetivo

```
clipboard-sync-repo/
│
├── assets/
│   ├── logo.svg                   ← logo original (fuente de verdad)
│   └── logo.ico                   ← generado desde logo.svg (tamaños 16/32/48/256 px); commitear
│
├── scripts/
│   └── generate-icon.mjs          ← script Node que convierte logo.svg → logo.ico
│
├── src/
│   └── script.ts                  ← lógica de sincronización (migrado desde script.js)
│
├── launcher/                      ← proyecto C# del launcher (bootstrap + update check)
│   ├── ClipboardSync.csproj
│   ├── Program.cs
│   ├── UpdaterWindow.cs
│   └── Updater/                   ← proyecto C# del updater
│       ├── Updater.csproj
│       ├── Program.cs
│       └── UpdaterWindow.cs
│
├── sync-ui/                       ← proyecto C# de la app principal (NUEVO)
│   ├── SyncApp.csproj
│   ├── Program.cs                 ← single-instance mutex + punto de entrada
│   ├── MainForm.cs                ← ventana/tray icon con log de mensajes
│   └── SyncEngineManager.cs      ← gestión del ciclo de vida del engine (start/stop/restart)
│
├── libs/
│   └── clipboard_x86_64.exe
│
├── dist/                          ← generado, no commitear
│
├── .github/
│   └── workflows/
│       └── release.yml            ← CI que genera la release automáticamente
│
├── package.json
├── tsconfig.json                  ← nuevo
├── .gitignore
└── README.md
```

---

## Estructura de releases en GitHub

Cada release en GitHub contendrá:

```
GitHub Release vX.Y.Z
├── ClipboardSync-Setup.exe        ← para que el usuario descargue (primera vez)
├── app.zip                        ← launcher.exe + clipboard-sync-ui.exe + clipboard-sync-engine.exe + libs\ + updater.exe + version.txt
└── app.zip.sha256                 ← hash SHA-256 del app.zip
```

El `ClipboardSync-Setup.exe` **es el mismo binario** que `launcher.exe` — detecta si se ejecuta fuera de `LocalAppData` y actúa como setup automáticamente.

---

## Plan paso a paso

### Fase 1 — Migrar `script.js` a TypeScript

- [ ] **1.1** Instalar dependencias de desarrollo:
  ```powershell
  npm install --save-dev typescript @types/node ts-node @yao-pkg/pkg sharp png-to-ico
  ```
  > `pkg` (Vercel) está abandonado y no soporta Node 18+. Se usa `@yao-pkg/pkg` como devDependency, compatible con Node 24.
- [ ] **1.2** Generar `assets/logo.ico` a partir de `assets/logo.svg`:
  - Crear `scripts/generate-icon.mjs`:
    ```js
    import sharp from 'sharp';
    import pngToIco from 'png-to-ico';
    import {writeFileSync} from 'fs';
    const sizes = [16, 32, 48, 256];
    const pngs = await Promise.all(sizes.map((s) => sharp('assets/logo.svg').resize(s, s).png().toBuffer()));
    writeFileSync('assets/logo.ico', await pngToIco(pngs));
    console.log('assets/logo.ico generado.');
    ```
  - Añadir script en `package.json`: `"generate-icon": "node scripts/generate-icon.mjs"`
  - Ejecutar **una vez en local** (`npm run generate-icon`) y commitear el `assets/logo.ico` resultante. El ICO se trata como asset estático (no se regenera en CI salvo que cambie el SVG).
- [ ] **1.2** Crear `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "module": "commonjs",
      "outDir": "dist",
      "strict": true,
      "esModuleInterop": true
    },
    "include": ["src/**/*"]
  }
  ```
- [ ] **1.3** Mover `script.js` → `src/script.ts` y añadir tipos.
- [ ] **1.4** Actualizar `package.json`:
  - `"main": "dist/script.js"`
  - `"scripts"`:
    - `"build": "tsc"`
    - `"package": "npm run build && pkg ."` ← `pkg` resuelve al bin de `@yao-pkg/pkg` instalado en `node_modules/.bin`
  - Sección `pkg`: apuntar a `dist/script.js`; cambiar nombre de salida a `clipboard-sync-engine.exe`; cambiar target de `node16-win-x64` a `node24-win-x64`; eliminar target `node16-macos-x64`; añadir `"icon": "assets/logo.ico"` para que el icono aparezca en el Administrador de tareas y el Explorador de archivos
  - Eliminar `readline-sync` de `dependencies` (ya no se usa).
- [ ] **1.5** Verificar que `npm run build && npm run package` genera `clipboard-sync-engine.exe` correctamente.
- [ ] **1.6** Migrar la ruta de config de `~/.clipboard-sync-config.json` a `%LOCALAPPDATA%\clipboard-sync\config.json` (con fallback si ya existe la ruta antigua).
- [ ] **1.7** Eliminar toda interacción con `stdin` del engine (`readline-sync`) — el `userId` se obtiene exclusivamente de `config.json`. Si no existe, el engine debe salir con error descriptivo por `stderr` (la UI C# se encargará de guiar al usuario).
- [ ] **1.8** Implementar lógica de **instancia única del engine**: al arrancar, buscar procesos con el mismo nombre de ejecutable y matarlos antes de continuar.
- [ ] **1.9** Asegurarse de que todos los mensajes de log usan `console.log` / `console.error` de forma que puedan ser capturados por `stdout`/`stderr` desde el proceso padre C#.

---

### Fase 2 — Crear el Launcher C#

- [ ] **2.1** Crear solución C# en `launcher/`:
  ```powershell
  dotnet new winforms -n ClipboardSync -o launcher/ -f net9.0-windows
  ```

  - En `launcher/ClipboardSync.csproj`, añadir dentro de `<PropertyGroup>`:
    ```xml
    <ApplicationIcon>..\..\assets\logo.ico</ApplicationIcon>
    ```
    Esto embute el icono en el `.exe`, que aparecerá en el Explorador de archivos y el Administrador de tareas.
- [ ] **2.2** Implementar lógica de **modo setup** (se ejecuta fuera de `LocalAppData`):
  - Crear directorio `%LOCALAPPDATA%\clipboard-sync\`
  - Copiarse a sí mismo como `launcher.exe`
  - Crear acceso directo `.lnk` en el escritorio apuntando a `launcher.exe`; establecer `IconLocation = $"{launcherPath},0"` para que el acceso directo use el icono embebido en el propio exe
  - Mostrar mensaje breve: _"Acceso directo creado en el escritorio. Úsalo de ahora en adelante."_
  - Relanzar `launcher.exe` desde `LocalAppData` y cerrarse
- [ ] **2.3** Implementar lógica de **modo normal** (se ejecuta desde `LocalAppData`):
  - Si `clipboard-sync-ui.exe` no existe en el directorio (primera instalación real, el usuario acaba de ejecutar el setup) → ejecutar directamente el flujo de descarga de `app.zip` de forma **obligatoria**, sin mostrar diálogo de confirmación, con un mensaje de progreso tipo _"Instalando aplicación..."_. Tras la extracción, lanzar `tmp_updater\updater.exe` como en cualquier update y cerrarse.
  - Si `version.txt` no existe (primera instalación), tratarlo como versión `0.0.0` — garantiza que cualquier release real se considerará más nueva y no rompe el flujo de comparación.
  - Leer `version.txt` local
  - Llamar a la GitHub Releases API: `https://api.github.com/repos/{owner}/{repo}/releases/latest` con timeout de 5 segundos
  - Si la llamada falla (sin red, timeout, error HTTP) → lanzar `clipboard-sync-ui.exe` directamente y cerrarse sin mostrar error al usuario
  - Comparar versiones
  - Si no hay update → lanzar `clipboard-sync-ui.exe` y cerrarse (sin mostrar ventana del launcher)
  - Si hay update → mostrar diálogo (ver 2.4)
- [ ] **2.4** Implementar **diálogo de actualización** con WinForms:
  - Mensaje: _"Hay una nueva versión disponible (vX.Y.Z).\n¿Quieres descargarla?\nSi no la descargas, la funcionalidad puede no ser correcta."_
  - Botón **Continuar** (estilo secundario)
  - Botón **Actualizar** (color de fondo `#2cb232`, texto blanco)
  - Al pulsar Continuar → lanzar `clipboard-sync-ui.exe` y cerrarse
  - Al pulsar Actualizar → iniciar Fase 4

---

### Fase 3 — Crear la aplicación principal C# (`clipboard-sync-ui.exe`)

- [ ] **3.1** Crear proyecto C# en `sync-ui/`:
  ```powershell
  dotnet new winforms -n SyncApp -o sync-ui/ -f net9.0-windows
  ```

  - En `sync-ui/SyncApp.csproj`, añadir dentro de `<PropertyGroup>`:
    ```xml
    <ApplicationIcon>..\assets\logo.ico</ApplicationIcon>
    ```
- [ ] **3.2** Implementar **single-instance** con `Mutex` global con nombre conocido:
  - Si ya existe una instancia → traerla al primer plano y cerrarse.
- [ ] **3.3** Implementar `SyncEngineManager` para gestionar el ciclo de vida del engine:
  - `Start()`: lanza `clipboard-sync-engine.exe` con `ProcessStartInfo` → `CreateNoWindow = true`, `UseShellExecute = false`, `RedirectStandardOutput = true`, `RedirectStandardError = true`. Establecer `EnableRaisingEvents = true` en el objeto `Process` para que el evento `Exited` se dispare. Resolver la ruta al engine relativa a la ubicación del propio ejecutable de la UI (`Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)`).
  - `Stop()`: envía señal de terminación (`Process.Kill()`) de forma controlada.
  - `Restart()`: llama a `Stop()` seguido de `Start()`.
  - Suscripción a `OutputDataReceived` / `ErrorDataReceived` → dispara evento hacia la UI.
  - Suscripción a `Exited` → detecta caídas inesperadas del engine.
- [ ] **3.4** Implementar `MainForm` (ventana principal o tray icon):
  - Al inicializar el formulario, asignar el icono desde el propio ejecutable: `this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath)`. Esto garantiza que la ventana, la barra de tareas y el tray icon usen el mismo icono embebido sin necesitar un fichero externo en tiempo de ejecución.
  - Área de log con scroll que muestra en tiempo real los mensajes del engine.
  - Indicador de estado (Activo / Detenido / Error).
  - Botones **Detener** y **Reiniciar**.
  - Al detectar caída inesperada del engine (evento `Exited` con código ≠ 0) → mostrar estado Error + botón **Reiniciar**.
- [ ] **3.5** Al cerrar la UI (`FormClosing`), detener el engine antes de salir.
- [ ] **3.6** Validar que `config.json` existe y contiene `userId` antes de lanzar el engine; si no, mostrar un diálogo para que el usuario introduzca su `userId` y guardarlo.

---

### Fase 4 — Implementar el proceso de descarga y actualización

> Todo esto ocurre dentro del mismo proceso del launcher C#, antes de lanzar el updater.

- [ ] **4.1** Descargar `app.zip.sha256` de la release de GitHub a memoria.
- [ ] **4.2** Descargar `app.zip` a `%LOCALAPPDATA%\clipboard-sync\tmp_updater\app.zip`.
  - Mostrar progreso de descarga en el diálogo (barra o porcentaje).
  - Si la descarga falla con excepción de red → eliminar `tmp_updater\` (si existe), mostrar error y cerrar.
- [ ] **4.3** Calcular SHA-256 del `app.zip` descargado y comparar con el hash de `app.zip.sha256`.
  - Si no coincide → eliminar `tmp_updater\`, mostrar error y cerrar.
- [ ] **4.4** Extraer `app.zip` en `tmp_updater\`.
- [ ] **4.5** Lanzar `tmp_updater\updater.exe` y cerrarse.

---

### Fase 5 — Crear el Updater C#

- [ ] **5.1** Crear proyecto C# independiente en `launcher/Updater/`:
  ```powershell
  dotnet new winforms -n Updater -o launcher/Updater/ -f net9.0-windows
  ```

  - En `launcher/Updater/Updater.csproj`, añadir dentro de `<PropertyGroup>`:
    ```xml
    <ApplicationIcon>..\..\..\assets\logo.ico</ApplicationIcon>
    ```
- [ ] **5.2** Implementar ventana de progreso:
  - Al inicializar, asignar `this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath)` para que la ventana del updater también muestre el icono correcto.
  - Mensaje: _"Actualizando, esto podría tardar unos minutos..."_
  - Sin botón de cerrar (o deshabilitado durante la copia)
- [ ] **5.3** Antes de copiar, terminar procesos bloqueantes:
  - Buscar y matar procesos `clipboard-sync-ui.exe` y `clipboard-sync-engine.exe` si están en ejecución (un proceso activo en Windows bloquea su propio `.exe` e impide sobreescribirlo).
  - Esperar a que ambos procesos hayan terminado antes de continuar.
- [ ] **5.4** Copiar archivos de `tmp_updater\` a `%LOCALAPPDATA%\clipboard-sync\` sobreescribiendo.
  - Excluir `updater.exe` y `app.zip` de la copia (no son parte de la app final).
- [ ] **5.5** Actualizar `version.txt` con la nueva versión.
- [ ] **5.6** Escribir el `.bat` temporal en `%TEMP%` (no en `tmp_updater`, ya que ese directorio se borrará) y lanzarlo. El `.bat` espera a que `Updater.exe` haya terminado, limpia y relanza:
  ```batch
  @echo off
  :waitloop
  tasklist /FI "IMAGENAME eq Updater.exe" 2>NUL | find /I "Updater.exe" >NUL
  if not ERRORLEVEL 1 (
      timeout /t 1 /nobreak >NUL
      goto waitloop
  )
  rd /s /q "%LOCALAPPDATA%\clipboard-sync\tmp_updater"
  start "" "%LOCALAPPDATA%\clipboard-sync\launcher.exe"
  del "%~f0"
  ```
  > Nota: este `.bat` es un script de runtime temporal, no de desarrollo, por lo que CMD es correcto aquí.
- [ ] **5.7** Cerrarse.

---

### Fase 6 — Configurar GitHub Actions para releases automáticas

- [ ] **6.1** Crear `.github/workflows/release.yml` que se dispare con `push` de un tag `v*.*.*`.
  - El runner debe ser `windows-latest` (necesario para generar los `.exe` de Windows con WinForms y para que `@yao-pkg/pkg` produzca el binario `node24-win-x64`).
- [ ] **6.2** El workflow debe:
  1. Instalar Node 24
  2. Ejecutar `npm install` (instala `@yao-pkg/pkg` como devDependency junto al resto)
  3. Compilar `src/script.ts` con `tsc` (`npm run build`)
  4. Empaquetar con `npm run package` (`@yao-pkg/pkg`, target `node24-win-x64`) → `clipboard-sync-engine.exe`
  5. Compilar el launcher C# → `dotnet publish launcher/ -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o dist/launcher`
  6. Compilar el updater C# → `dotnet publish launcher/Updater/ -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o dist/updater`
  7. Compilar la app principal C# → `dotnet publish sync-ui/ -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o dist/sync-ui`
  8. Crear `app.zip` con: `launcher.exe` (= `ClipboardSync.exe`), `clipboard-sync-ui.exe`, `clipboard-sync-engine.exe`, `libs/clipboard_x86_64.exe`, `updater.exe`, `version.txt`
  9. Generar `app.zip.sha256`
  10. Publicar la release con los tres assets: `ClipboardSync-Setup.exe`, `app.zip`, `app.zip.sha256`
- [ ] **6.3** Añadir `version.txt` al repositorio con el valor inicial (ej. `1.0.0`).
- [ ] **6.4** Sincronizar la versión entre `package.json`, `version.txt` y el ensamblado C# (puede hacerse en el workflow).

---

### Fase 7 — Pruebas end-to-end

- [ ] **7.1** Probar primera ejecución desde carpeta de descargas → acceso directo creado en escritorio.
- [ ] **7.2** Probar arranque normal sin nueva versión → sin diálogo, `clipboard-sync-ui.exe` arranca directamente.
- [ ] **7.3** Probar arranque con nueva versión disponible → diálogo aparece correctamente.
- [ ] **7.4** Probar flujo completo de actualización → archivos sobreescritos, `tmp_updater` eliminado, app relanzada.
- [ ] **7.5** Probar fallo de descarga (desconectar red a mitad) → `tmp_updater` se limpia, mensaje de error.
- [ ] **7.6** Probar hash inválido → update abortado con mensaje.
- [ ] **7.7** Verificar que `config.json` migra correctamente desde la ruta antigua.
- [ ] **7.8** Verificar que `clipboard-sync-engine.exe` no abre ventana de consola cuando es lanzado por `clipboard-sync-ui.exe`.
- [ ] **7.9** Verificar que los mensajes de `stdout`/`stderr` del engine aparecen en tiempo real en la UI.
- [ ] **7.10** Verificar que al pulsar **Detener** el engine termina y el estado de la UI cambia a Detenido.
- [ ] **7.11** Verificar que al pulsar **Reiniciar** la instancia previa del engine es matada y se lanza una nueva.
- [ ] **7.12** Verificar que si el engine cae inesperadamente la UI muestra el error y ofrece **Reiniciar**.
- [ ] **7.13** Verificar que intentar abrir `clipboard-sync-ui.exe` por segunda vez pone en primer plano la instancia existente.
- [ ] **7.14** Verificar que si ya hay una instancia de `clipboard-sync-engine.exe` al lanzarse otra, la nueva mata la anterior y continúa.
- [ ] **7.15** Probar flujo de primera instalación completo: ejecutar `ClipboardSync-Setup.exe` desde descargas → se copia a LocalAppData → relanza → detecta ausencia de `clipboard-sync-ui.exe` → descarga y extrae `app.zip` automáticamente → lanza updater → `clipboard-sync-ui.exe` disponible y arranca correctamente.

---

### Fase 8 — Limpieza y documentación

- [ ] **8.1** Actualizar `.gitignore`: añadir `dist/`, `launcher/bin/`, `launcher/obj/`, `launcher/Updater/bin/`, `launcher/Updater/obj/`, `sync-ui/bin/`, `sync-ui/obj/`, `*.zip`. **No** añadir `assets/logo.ico` — ese archivo se commitea.
- [ ] **8.2** Actualizar `README.md` con las nuevas instrucciones de desarrollo y release.
- [ ] **8.3** Eliminar `clipboard-sync-win.zip` y `clipboard-sync-macos.zip` del repositorio (pasarán a generarse en CI).

---

## Notas adicionales

- **`libs/clipboard_x86_64.exe`**: Este binario (parte de `clipboardy`) debe estar commiteado en `libs/` del repositorio. Es el ejecutable que `clipboard-sync-engine.exe` usa en Windows para leer/escribir el portapapeles cuando se empaqueta con `pkg`. Si se necesita actualizar, descargarlo de la release correspondiente del paquete `clipboardy` de npm y sustituirlo manualmente.
- **macOS**: La arquitectura descrita es para Windows. Si en el futuro se quiere auto-update en macOS, el launcher C# no aplica — habría que hacer un equivalente en Swift o un script shell empaquetado. Por ahora `pkg` para macOS sigue siendo el objetivo pero sin launcher.
- **El launcher nunca se actualiza a sí mismo directamente** — si hay un bug crítico en él, el usuario deberá descargar el nuevo `ClipboardSync-Setup.exe` manualmente. Por eso la lógica del launcher debe ser mínima y estable.
- **Sin registro de Windows** — toda la persistencia va a `LocalAppData`, manteniendo la naturaleza portable.
