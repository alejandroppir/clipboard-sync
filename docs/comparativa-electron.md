# Comparativa: Electron 1.0.7 frente a Tauri 2.0.0

Medido el 2026-11-08 en el mismo equipo (Windows 11), con builds de release locales y el mismo usuario de prueba. Cada app se midió por separado.

## Resultados

| | Electron 1.0.7 | Tauri 2.0.0 | Diferencia |
|---|---|---|---|
| **Portable `ClipboardSync.exe`** | 93,1 MB | **6,4 MB** | 14,5 veces menos |
| **Disco que usa al ejecutarse** | 93 MB + **369 MB** extraídos en `%TEMP%` cada vez que arranca | 6,4 MB; no extrae nada | 72 veces menos |
| **Instalador** | no había | 2,3 MB | |
| **Arranque, primera vez** | 11,6 s | **0,4 s** | 29 veces más rápido |
| **Arranque, siguientes veces** | 10,7 s | **0,16 s** | 67 veces más rápido |
| **RAM en la bandeja** (memoria privada) | 197 MB en 4 procesos | **7 MB en 1 proceso** | 28 veces menos |
| **RAM en la bandeja** (working set) | 335 MB | **36 MB** | 9 veces menos |
| **RAM con la ventana abierta** (memoria privada) | 276 MB en 5 procesos | 216 MB en 7 procesos | 22 % menos |
| **CPU en la bandeja** | 0,08 s por minuto | 0,05 s por minuto | las dos casi nada |

## Qué significan

- **En la bandeja está la gran ganancia**, que es donde la app pasa casi todo el tiempo. Electron mantiene vivo Chromium aunque se cierre la ventana. Tauri destruye el webview y solo deja el proceso de Rust, que hace la sincronización.
- **Con la ventana abierta la mejora es pequeña:** WebView2 también es Chromium.
- **El arranque de Electron** se va casi entero en extraer el portable a `%TEMP%` (unos 7 s) y en el splash, que dura como mínimo 1,5 s.

## Cómo se midió

- **Builds:**
  - Electron con `npm run package`, que genera `dist-release\ClipboardSync.exe`;
  - Tauri con `npx tauri build`, que genera `target\release\ClipboardSync.exe`.
- **Arranque:** desde que se lanza el exe hasta que aparece la ventana principal. "Primera vez" es el primer lanzamiento de la sesión, no tras reiniciar el equipo.
- **RAM:** la suma de todo el árbol de procesos: los de Chromium en Electron y los de WebView2 en Tauri.
  - **Ventana abierta:** 20 s después de arrancar.
  - **Bandeja:** 15 s después de cerrar la ventana con la X.
  - **CPU:** durante el minuto siguiente.
- **Disco temporal:** tamaño de la carpeta que el portable de Electron extrae en `%TEMP%`.

## Sin medir

- Arranque tras reiniciar el equipo.
- RAM tras horas en la bandeja.
- El runtime de WebView2: no se cuenta en el disco de Tauri porque viene con Windows y lo comparten todas las apps.

## Si repites la medición desde una terminal de VS Code

VS Code define `ELECTRON_RUN_AS_NODE=1`. Con esa variable, Electron arranca como Node y se cierra sin abrir nada. Quítala antes de lanzarlo con `Remove-Item Env:ELECTRON_RUN_AS_NODE`. Con doble clic no pasa.
