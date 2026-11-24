# Publicar una versión

## Pasos

1. En `.github/release-notes.md`, cambia la lista de `## Novedades` por lo que trae la versión, una línea `- ` por cambio, y súbelo a la rama. Si queda vacía, la publicación falla.
2. GitHub → **Actions** → **Release** → **Run workflow**.
3. Rellena `version` (por ejemplo `2.0.1`, sin la `v`). `appName` puede quedarse vacío.
4. El workflow comprueba que la versión no esté publicada, compila, firma y crea la release `v2.0.1` con todos los ficheros. Ese fichero es el texto de la release.

Las novedades se ven en tres sitios: el botón "Novedades" del aviso de actualización, una ventana que se abre una vez al arrancar la versión nueva y la página de la release.

Las copias instaladas la verán en un máximo de 4 horas, o al arrancar.

## Repositorio de las releases

Las apps instaladas buscan las actualizaciones en un repositorio fijo:

| Dónde | Valor actual |
|---|---|
| `src-tauri/src/updater/mod.rs` → `RELEASES_URL` | `https://github.com/alejandroppir/clipboard-sync/releases` |
| `.github/workflows/release.yml` → `RELEASE_REPO` | `alejandroppir/clipboard-sync` |

Las versiones **Electron (1.x)** también buscan en ese repositorio, y no se pueden cambiar. Para que migren solas, la release 2.x tiene que publicarse ahí.

### Si el código vive en otro repositorio

1. Crea un token de GitHub con permiso `contents: write` sobre `alejandroppir/clipboard-sync`.
2. Guárdalo como secreto `RELEASE_TOKEN` en el repositorio del código.

El workflow ya lo usa si existe. En ese caso la etiqueta `vX.Y.Z` se crea sobre la rama por defecto del repositorio de releases, no sobre el commit compilado.

### Si cambia el repositorio de releases

1. Cambia los dos valores de la tabla.
2. Publica una versión **en el repositorio antiguo** con la URL nueva. Las copias instaladas solo saben buscar en el antiguo hasta que se actualizan a esa versión.

## Nombre de la aplicación

El nombre visible está en `src-tauri/tauri.conf.json` → `productName`. Se usa en:
- la ventana y la bandeja;
- la entrada de arranque con Windows;
- el instalador: carpeta de instalación, menú Inicio y "Aplicaciones instaladas".

El campo `appName` del workflow lo cambia solo para esa build. Los ficheros publicados mantienen siempre sus nombres (`ClipboardSync*.exe`), porque las actualizaciones los buscan así.

**Cuidado:** cambiar el nombre entre versiones hace que el instalador use otra carpeta y otra entrada en "Aplicaciones instaladas". Las copias instaladas acabarían duplicadas. A la portable no le afecta. Elige un nombre y mantenlo, o cámbialo en `tauri.conf.json` de forma permanente.

## Firma de las actualizaciones

Cada exe se firma con una clave privada. La app solo instala lo que valida con la clave pública que lleva dentro (`PUBLIC_KEY` en `src-tauri/src/updater/download.rs`).

### Dónde está la clave

| Fichero | Contenido | Dónde debe estar |
|---|---|---|
| `%USERPROFILE%\.tauri\clipboard-sync.key` | Clave privada | Solo en tu equipo y en el secreto de GitHub. **Nunca en el repositorio** |
| `%USERPROFILE%\.tauri\clipboard-sync.key.pub` | Clave pública | Copiada en `PUBLIC_KEY` |

Guarda una copia de la privada fuera del equipo, por ejemplo en un gestor de contraseñas. Si se pierde, ninguna copia instalada aceptará actualizaciones nuevas.

### Configurar GitHub (una sola vez)

1. Abre `%USERPROFILE%\.tauri\clipboard-sync.key` con el Bloc de notas y copia todo el texto.
2. GitHub → repositorio → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. Nombre: `TAURI_SIGNING_PRIVATE_KEY`. Valor: el texto copiado.
4. La clave actual no tiene contraseña: no hace falta el secreto `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Si generas una con contraseña, créalo con ese nombre.

### Firmar en local

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\clipboard-sync.key"
./scripts/package-release.ps1 -Version 2.0.1
```

Los ficheros quedan en `release/`.

### Cambiar la clave

Solo si se filtra o se pierde.

1. `npx tauri signer generate -w "$env:USERPROFILE\.tauri\clipboard-sync.key" -f`. Añade `-p <contraseña>` si quieres protegerla.
2. Copia el contenido del `.pub` en `PUBLIC_KEY` y actualiza el secreto de GitHub.
3. Las copias ya instaladas confían en la clave antigua:
   - **Si aún la tienes:** publica una versión de transición firmada con la clave antigua que ya lleve la pública nueva.
   - **Si la perdiste:** los usuarios tendrán que descargar la versión nueva a mano.
