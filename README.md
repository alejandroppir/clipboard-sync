# ClipSync

Sincroniza el portapapeles de texto entre varios equipos Windows a través de Firebase Firestore.

Versión 2, hecha con **Tauri + Rust**. Sustituye a la versión Electron (1.x): usa los mismos datos en Firestore y la misma configuración, y la 1.x se actualiza sola a esta.

## Instalar

En la sección **Releases** del repositorio:

| Quieres… | Descarga |
|---|---|
| Instalarla (recomendado) | `ClipboardSync-setup.exe` |
| Usarla sin instalar | `ClipboardSync.exe`: guárdalo en una carpeta fija y ábrelo desde ahí |

Si la red no deja descargar `.exe` ni `.zip`:

1. Descarga el `.custom` equivalente.
2. Cámbiale la extensión a `.zip`.
3. Descomprímelo.

La primera vez pide un **identificador de usuario**. Usa el mismo en todos los equipos que quieras sincronizar.

Necesita **WebView2**, que viene con Windows 10 y 11. El instalador lo instala si falta.

## Uso

- **Bandeja del sistema:** la app vive en la bandeja.
  - Cerrar la ventana no la detiene.
  - Clic en el icono para abrirla.
  - Clic derecho para el menú: abrir, activar o desactivar la sincronización, reiniciarla, pausarla (15 minutos o 1 hora), reiniciar la aplicación y salir.
- **Ventana:**
  - estado de la sincronización, interruptor para activarla o desactivarla (se recuerda al reiniciar) y usuario;
  - **cifrado** opcional del contenido con una contraseña. Todos los equipos del usuario necesitan la versión 2.0.0 o superior y la misma contraseña: los demás dejan de sincronizarse con él;
  - actividad: subidas, descargas y errores;
  - historial: los últimos 20 textos sincronizados, para copiar uno de nuevo. Solo en memoria;
  - avisos de actualización y mensajes del administrador;
  - interruptor **Arrancar con Windows**, que arranca la app directamente en la bandeja.
- **Administración:** tres clics en la versión (a la derecha de las pestañas), o `Ctrl+Shift+A`. Pide la contraseña y permite:
  - ver los usuarios con su versión, su última subida y los caracteres que han copiado (hoy, semana, mes y total);
  - ver y borrar los errores de la aplicación;
  - escribir mensajes para todos (`global`) o para un usuario concreto.

Los textos de más de 1 MB (unos 750 KB con cifrado) no se suben, porque es el límite de un documento de Firestore.

## Desarrollo

Necesitas Rust (`rustup`), Node.js 24 y las herramientas de compilación de C++ de Visual Studio.

```powershell
npm install
npm run app        # abre la app en modo desarrollo; recompila al guardar
```

| Comando | Qué hace |
|---|---|
| `npm run app` | App en desarrollo. Regenera `src/rust/bindings.gen.ts` |
| `npm run build` | Comprueba los tipos y compila la interfaz en `dist/` |
| `npm run icons` | Regenera los iconos desde `src/assets/logo.svg` |
| `cd src-tauri; cargo test --lib` | Tests de Rust |
| `cd src-tauri; cargo clippy --all-targets` | Lint de Rust |
| `npm run admin-hash` | Pide una contraseña de administración y da el id del documento que hay que crear en `admin_config` (puede ir vacío) |
| `./scripts/package-release.ps1 -Version x.y.z` | Build firmada con todos los ficheros de una release, en `release/` |

**No se edita a mano:** `src/rust/bindings.gen.ts` lo genera `tauri-specta` al arrancar en desarrollo. Tiene los tipos y una función por cada comando de Rust. Súbelo al repositorio, porque el build de producción no lo regenera.

## Cómo está repartido el trabajo

- **Rust:** todo el trabajo (portapapeles, Firestore, bandeja, actualizaciones).
- **Webview:** solo dibuja la ventana, y **se destruye al cerrarla**. Con la app en la bandeja solo queda el proceso de Rust.

La conexión con Firestore usa el crate `firestore` (gRPC) con la API key web del proyecto, sin sesión de usuario, igual que el SDK web. Por eso las reglas de seguridad de Firestore son lo único que protege los datos.

## Más documentación

- [Estructura del proyecto: qué hay en cada carpeta y cada fichero](docs/estructura.md)
- [Cómo se actualiza la aplicación](docs/actualizaciones.md)
- [Publicar una versión, repositorio de releases, nombre y firma](docs/publicar-version.md)
- [Comparativa con la versión Electron: tamaño, arranque, RAM](docs/comparativa-electron.md)
