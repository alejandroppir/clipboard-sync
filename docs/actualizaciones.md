# Cómo se actualiza la aplicación

## Resumen

1. Al arrancar y cada 4 horas, la app lee `update.json` de la última release de GitHub.
2. Si la versión es mayor que la instalada, la ventana se abre sin robar el foco, parpadea en la barra de tareas y ofrece la actualización.
3. Si el usuario acepta, se descarga el paquete que corresponde a su copia:
   - **instalada** (hay un `uninstall.exe` junto al exe): el instalador `ClipboardSync-setup.exe`;
   - **portable**: el exe `ClipboardSync.exe`.
4. Primero se intenta el `.exe` directo. Si falla, o lo que llega no tiene una firma válida (un proxy puede devolver su propia página), se descarga el `.custom` y se descomprime en memoria.
5. **La firma se comprueba siempre**, venga del `.exe` o del `.custom`. Si no coincide, no se instala nada.
6. Cuando el usuario elige "Reiniciar ahora":
   - **instalada**: ejecuta `ClipboardSync-setup.exe /S /UPDATE /R`, que instala en silencio, cierra la app y la vuelve a abrir. Windows muestra la versión nueva en "Aplicaciones instaladas";
   - **portable**: lanza el exe nuevo en modo actualización (ver abajo) y se cierra.

El código está en `src-tauri/src/updater/`.

## Ficheros de cada release

| Fichero | Para qué |
|---|---|
| `ClipboardSync.exe` | Versión portable |
| `ClipboardSync.custom` | Zip con `ClipboardSync.exe`, con otra extensión |
| `ClipboardSync-setup.exe` | Instalador |
| `ClipboardSync-setup.custom` | Zip con `ClipboardSync-setup.exe` |
| `update.json` | Lo leen las versiones 2.x |
| `latest.yml` | Lo leen las versiones Electron 1.x para migrar a la 2.x |

Los nombres son fijos aunque cambie el nombre visible de la app: el código y las versiones antiguas los buscan así.

### `update.json`

```json
{
  "version": "2.0.1",
  "notes": ["Lo nuevo de esta versión", "…"],
  "portable":  { "file": "ClipboardSync.exe",       "custom": "ClipboardSync.custom",       "signature": "<firma>" },
  "installer": { "file": "ClipboardSync-setup.exe", "custom": "ClipboardSync-setup.custom", "signature": "<firma>" }
}
```

`notes` son las líneas `- ` de la sección `## Novedades` de `.github/release-notes.md`: la app las enseña con el botón "Novedades" del aviso.

`signature` es la firma del `.exe`, tal como la imprime `tauri signer sign --app-version <versión>`. Incluye el nombre del fichero y la versión, y la app comprueba los dos: nadie puede anunciar como nueva una versión antigua firmada. Se firma el ejecutable, no el `.custom`: así una sola firma vale para las dos formas de descarga.

## Modo actualización (portable)

El exe nuevo se lanza así:

```text
ClipboardSync.exe --update-mode --pid <pid> --source <exe nuevo> --target <exe actual>
```

1. Muestra una ventana pequeña de "Actualizando…".
2. Intenta copiar `source` sobre `target` cada medio segundo, durante 60 s como máximo. La copia falla mientras el proceso antiguo no haya cerrado, porque Windows bloquea el exe en uso.
3. Arranca `target`. Si la copia no se pudo hacer, arranca la versión antigua, para que el usuario no se quede sin app.

**No cambies estos argumentos.** Son los mismos que usa la versión Electron 1.0.7 al instalar el primer `.custom` de la 2.x. Así migra sola:

1. La 1.0.7 lee `latest.yml`, ve una versión mayor y descarga `ClipboardSync.custom`.
2. Comprueba su `sha512` contra `latest.yml` y lo descomprime.
3. Lanza el `ClipboardSync.exe` nuevo con esos argumentos.

## Probar una actualización sin publicar

La variable `CLIPBOARD_SYNC_UPDATE_SOURCE` sustituye a GitHub por una carpeta servida por HTTP. Además, activa las comprobaciones en las builds de desarrollo.

1. Genera la versión "nueva": `./scripts/package-release.ps1 -Version 9.9.9` (ver `docs/publicar-version.md` para la clave).
2. Sirve la carpeta `release/`: `npx http-server release -p 8787`.
3. Arranca la versión "antigua" con `$env:CLIPBOARD_SYNC_UPDATE_SOURCE = "http://localhost:8787"`.

Para probar el `.custom`, borra o corrompe `ClipboardSync.exe` en la carpeta servida: la app debe usar el `.custom` y anotarlo en la actividad.

## Limitaciones conocidas

- Una copia portable dentro de una carpeta sin permiso de escritura, como `Program Files`, no se puede sustituir. La copia falla y se vuelve a abrir la versión antigua.
- Los ficheros descargados quedan en `%TEMP%\ClipboardSync-update-<versión>`. Windows limpia `%TEMP%` por su cuenta.
