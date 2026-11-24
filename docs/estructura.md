# Estructura del proyecto

La app tiene dos partes:

- **`src/`, la interfaz**: HTML, CSS y TypeScript. Solo dibuja la ventana.
- **`src-tauri/`, el programa en Rust**: hace todo el trabajo, que es leer el portapapeles, hablar con Firestore, la bandeja y las actualizaciones.

`src-tauri/` es el nombre que Tauri espera para la parte de Rust, y su CLI lo busca ahí. Los resultados de compilar no se quedan dentro, sino en la raíz: `dist/` la interfaz y `target/` el programa.

## Raíz

| Ruta | Qué es |
|---|---|
| `package.json` | Dependencias de la interfaz y los scripts `npm run …` (ver el README) |
| `vite.config.ts` | Compilación de la interfaz: la raíz es `src/`, el resultado va a `dist/`, puerto fijo para el modo desarrollo, las dos páginas de entrada y la unión de los trozos de `src/html/` |
| `tsconfig.json` | TypeScript en modo estricto |
| `.gitignore` | Excluye lo que se genera: `node_modules/`, `dist/`, `target/`, `release/` |
| `.gitattributes` | Marca `src/rust/bindings.gen.ts` como generado: GitHub lo pliega en los diffs |
| `.vscode/settings.json` | Abre `src/rust/bindings.gen.ts` en solo lectura |
| `README.md` | Qué es la app, cómo instalarla y los comandos de desarrollo |

## Carpetas que se generan (no se editan ni se suben)

| Carpeta | La genera | Contiene |
|---|---|---|
| `node_modules/` | `npm install` | Dependencias de la interfaz |
| `dist/` | `npm run build` | La interfaz compilada. Se incrusta dentro del exe |
| `target/` | `cargo` / `npx tauri build` | El programa compilado. Ver abajo |
| `release/` | `scripts/package-release.ps1` | Los ficheros de una release, con su nombre definitivo y firmados |
| `src-tauri/gen/` | Tauri | Esquemas de permisos para el editor |

Dentro de `target/`:

- `target/debug/`: compilación de desarrollo, la de `npm run app`.
- `target/release/ClipboardSync.exe`: el **portable**. Es un exe autónomo, no necesita instalarse.
- `target/release/bundle/nsis/ClipSync_<versión>_x64-setup.exe`: el **instalador**.

La salida va a la raíz por `src-tauri/.cargo/config.toml` (`target-dir = "../target"`).

## `src/`: interfaz

| Ruta | Qué hace |
|---|---|
| `rust/` | La frontera con Rust: lo único que habla con el programa. `ui/` solo usa sus funciones tipadas, nunca `invoke` directamente |
| `utils/` | Utilidades genéricas, sin nada propio de la app |
| `index.html` | Ventana principal: panel de sincronización, avisos, actividad y pie. El resto lo trae de `html/` con `{{> nombre}}` |
| `update.html` | Ventana pequeña de "Actualizando…" que aparece mientras se reemplaza el portable |
| `main.ts` | Punto de entrada. Se suscribe a los eventos de Rust, pide el estado inicial (`getSnapshot`), pinta cada zona y quita el loader |
| `rust/bindings.gen.ts` | **Generado** por tauri-specta al arrancar en desarrollo. Una función tipada por cada comando de Rust, un objeto por cada evento y las constantes que comparten (`LogType`, `SyncState`, `UpdateState`…): se usa `LogType.Info`, no `"info"`. No se edita (VS Code lo abre en solo lectura), pero sí se sube |
| `rust/result.ts` | `unwrap()`: convierte el resultado de un comando en su valor, o en una excepción con el mensaje de error de Rust |
| `utils/dom.ts` | Utilidades de DOM: `byId`, `part` (un hijo de una plantilla), `fromTemplate`, `showFieldError`, `initTabs`, `errorMessage` |
| `assets/logo.svg` | Logo de las ventanas y origen de los iconos (`npm run icons`) |

### `src/html/`: trozos de `index.html`

Al compilar, `vite-plugin-handlebars` sustituye cada `{{> nombre}}` de `index.html` por `html/nombre.html`. El resultado sigue siendo un solo HTML por ventana, así que `byId(...)` encuentra todo al arrancar. Cada trozo acompaña a su fichero de `ui/`.

| Fichero | Contiene | Lo usa |
|---|---|---|
| `icons.html` | Los iconos SVG (`<symbol id="icon-…">`) | Todas las zonas |
| `user-dialog.html` | Diálogo del identificador de usuario | `ui/user-dialog.ts` |
| `encryption-dialog.html` | Diálogo de la contraseña de cifrado y sus avisos | `ui/encryption-dialog.ts` |
| `admin-panel.html` | Login y panel de administración | `ui/admin-panel.ts` |
| `release-notes.html` | Diálogo de novedades | `ui/release-notes.ts` |
| `templates.html` | Filas que se repiten (`<template>`): actividad, historial, usuarios, mensajes y errores | `ui/activity-log.ts`, `ui/history.ts`, `ui/admin-panel.ts` |

### `src/ui/`: una pieza por zona de la ventana

| Fichero | Zona |
|---|---|
| `status-bar.ts` | La versión y el panel de sincronización: estado, icono, error, usuario, interruptor y botón según el estado |
| `activity-log.ts` | Lista de actividad. Mantiene el scroll abajo salvo que el usuario haya subido a leer |
| `history.ts` | Pestaña Historial: los últimos textos sincronizados y su botón para copiar de nuevo |
| `release-notes.ts` | Diálogo de novedades: se abre solo tras actualizar, o desde el botón "Novedades" del aviso de actualización |
| `user-dialog.ts` | Diálogo para escribir o cambiar el identificador de usuario |
| `update-banner.ts` | Aviso de actualización (disponible, descargando, lista, fallida). "Ahora no" lo pliega en una píldora |
| `notification-banner.ts` | Mensaje del administrador y su botón "Entendido" |
| `encryption-dialog.ts` | Poner, cambiar o quitar la contraseña de cifrado |
| `actions.ts` | Botones de sincronizar y del pie, interruptores de la sincronización y de "Arrancar con Windows", y aviso de la bandeja |
| `admin-panel.ts` | Acceso de administrador (tres clics en la versión o `Ctrl+Shift+A`), lista de usuarios (con su uso), mensajes y errores |

### `src/styles/`

| Fichero | Contiene |
|---|---|
| `theme.scss` | Lo común a todas las ventanas: los **tokens** (colores, espaciados, alturas, radios, tipografía, tiempos), los estilos base y las **utilidades** |
| `app.scss` | Componentes de la ventana principal. Solo usan tokens |
| `update.scss` | La ventana de "Actualizando…" |

Están en SCSS solo para anidar: cada bloque BEM escribe sus elementos y modificadores con `&` (`.btn { &--accent { … } }`). Vite los compila (dependencia `sass-embedded`). Los tokens siguen siendo variables CSS (`var(--space-2)`), no variables de Sass. No se usa `@extend`: lo que se comparte va como utilidad en el HTML.

Utilidades de `theme.scss`, que se combinan en el HTML:

| Clase | Efecto |
|---|---|
| `hstack` / `vstack` | Fila centrada en vertical / columna, con 8 px de separación |
| `gap-0`, `gap-1`, `gap-3`, `gap-4` | Cambian esa separación a 0, 4, 12 o 16 px |
| `grow` | Ocupa el espacio libre; también sirve de separador entre grupos |
| `between`, `end`, `center`, `wrap` | Alineación y salto de línea |
| `truncate` | Corta con "…" en una línea |
| `title`, `small`, `muted` | Texto: título, pequeño, gris |
| `icon`, `icon--sm` | Icono SVG de 16 o 14 px: `<svg class="icon"><use href="#icon-sync" /></svg>` |

Ejemplo: `<div class="hstack between">` es una fila con un elemento a cada lado.

Los iconos se dibujan una sola vez, como `<symbol id="icon-…">` en `html/icons.html`, y se reutilizan con `<use>`. Cada línea de actividad lleva un tipo (`LogType`) que decide su icono. Solo `success` (verde), `warning` (ámbar) y `error` (rojo) llevan color; el resto va en gris.

## `src-tauri/`: programa en Rust

| Ruta | Qué es |
|---|---|
| `Cargo.toml` | Dependencias de Rust y el perfil de release optimizado para tamaño |
| `Cargo.lock` | Versiones exactas de las dependencias. Se sube |
| `.cargo/config.toml` | Manda la compilación a `target/` en la raíz |
| `tauri.conf.json` | Nombre, identificador, CSP, iconos e instalador NSIS. La ventana no está aquí: la crea `window.rs` |
| `build.rs` | Paso de compilación que exige Tauri |
| `capabilities/default.json` | Permisos de la ventana: solo los básicos de Tauri |
| `icons/` | Iconos generados con `npm run icons` |

### `src-tauri/src/`

| Fichero | Qué hace |
|---|---|
| `main.rs` | Entrada del exe; llama a `lib.rs`. En release no abre consola |
| `lib.rs` | Arranque. Decide entre modo actualización y app normal, registra plugins y estado, crea la bandeja, abre la ventana (salvo con `--autostart`), arranca la sincronización y las comprobaciones de actualización. Impide que cerrar la ventana cierre la app |
| `commands.rs` | Todos los comandos que llama la ventana, el `Snapshot` inicial y la validación de identificadores |
| `config.rs` | Lee y guarda `%LOCALAPPDATA%\clipboard-sync\config.json`, el mismo fichero que usaba Electron: el identificador de usuario, si la sincronización está desactivada, la clave de cifrado (no la contraseña) y la última versión cuyas novedades se mostraron |
| `activity.rs` | Registro de actividad: últimas 500 líneas en memoria, cada una con su tipo (`LogType`), enviadas a la ventana cuando está abierta |
| `autostart.rs` | La entrada "Arrancar con Windows" del registro, con la ruta entre comillas |
| `clipboard.rs` | Leer y escribir texto en el portapapeles (reintenta si está ocupado), y avisar de cada cambio (`AddClipboardFormatListener` de Windows, con la librería `clipboard-master`) |
| `encryption.rs` | Cifrado del contenido: clave a partir de la contraseña (Argon2id), cifrar y descifrar (XChaCha20-Poly1305) |
| `usage.rs` | Caracteres copiados por el usuario: hoy, semana, mes y total. Viajan en el documento del portapapeles, en la misma escritura; cada número vuelve a cero al cambiar su periodo |
| `history.rs` | Historial de los últimos 20 textos sincronizados. Solo en memoria: nada se guarda en disco |
| `release_notes.rs` | Novedades de la versión: lleva dentro la sección `## Novedades` de `.github/release-notes.md` y la muestra una vez tras actualizar |
| `messages.rs` | Mensajes del administrador: el global y el de cada usuario. Recuerda los descartados, porque Firestore los reenvía al reconectar. Mostrar, marcar como leído, listar, guardar y borrar |
| `users.rs` | Contraseña de administrador (SHA-256 contra `admin_config`) y lista de usuarios con su versión y su uso |
| `error_report.rs` | Sube errores a la colección `errors` (esperan en memoria si no hay conexión), y los lista y borra para el panel |
| `tray.rs` | Icono y menú de la bandeja: activar o desactivar la sincronización, y las pausas de 15 minutos y 1 hora |
| `window.rs` | Crea, muestra y cierra la ventana principal. Cerrarla la destruye para liberar memoria |

#### `firebase/`

| Fichero | Qué hace |
|---|---|
| `mod.rs` | Proyecto, API key, nombres de las colecciones y la conexión compartida: se abre la primera vez que se usa, con un límite de 15 s por petición, y `reset()` la cambia por una nueva |
| `credentials.rs` | Se identifica solo con la API key (`x-goog-api-key`), igual que el SDK web sin sesión |

#### `sync/`

| Fichero | Qué hace |
|---|---|
| `mod.rs` | Activar, desactivar, reiniciar y pausar, y el estado que ven la ventana y la bandeja |
| `session.rs` | El trabajo: un solo bucle que sube lo que copias (300 ms después del aviso de Windows, máximo 1 MB) y escribe lo que llega de Firestore |

Qué hace `session.rs` cuando algo falla:

| Situación | Qué hace |
|---|---|
| Otra aplicación tiene el portapapeles, o la sesión está bloqueada (Win+L) | Reintenta cada 2 s hasta poder leer o escribir |
| El equipo se ha suspendido (el reloj salta más de 60 s) | Abre una conexión nueva, sin olvidar lo que ya estaba sincronizado |
| Falla la subida o no responde en 15 s | Abre una conexión nueva a los 5 s y vuelve a subir |
| Firestore cierra el listener | Abre una conexión nueva a los 5 s |
| El portapapeles lleva más de 1 hora sin dejarse escribir | Lo apunta en `errors`, una vez |
| Llega un texto cifrado sin contraseña aquí, o con otra; o sin cifrar habiendo contraseña | Lo ignora y avisa en la actividad |

Para no entrar en bucle recuerda dos textos: el último del portapapeles y el último de Firestore.

#### `updater/`

| Fichero | Qué hace |
|---|---|
| `mod.rs` | Comprueba `update.json` al arrancar y cada 4 horas, y guarda el estado de la actualización |
| `manifest.rs` | Formato de `update.json` y comparación de versiones |
| `download.rs` | Descarga el exe (o el `.custom` si falla) y comprueba la firma, el nombre del fichero y la versión |
| `install.rs` | Lanza la versión descargada: el instalador en silencio, o el portable en modo actualización |
| `update_mode.rs` | Modo actualización: el exe nuevo se copia encima del viejo y lo arranca. Acepta los mismos argumentos que la 1.0.7 de Electron |

## Otras carpetas

| Ruta | Qué es |
|---|---|
| `scripts/package-release.ps1` | Compila, firma y deja en `release/` todo lo que se publica. Ver [publicar-version.md](publicar-version.md) |
| `scripts/admin-password-hash.mjs` | `npm run admin-hash`: pide una contraseña de administración y da el id del documento de `admin_config` |
| `.github/workflows/release.yml` | El mismo proceso en GitHub Actions, solo al lanzarlo a mano |
| `.github/release-notes.md` | Texto de cada release: novedades (también las lee la app), qué descargar y cómo |
| `docs/` | Esta documentación |
