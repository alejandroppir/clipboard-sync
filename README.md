# Clipboard Sync

Sincronizador de portapapeles multiplataforma escrito en Node.js que usa Firebase y `clipboardy`. El script principal es `script.js` y el paquete está configurado para ser empaquetado con `pkg`.

**Estado del proyecto (actual):**

- `package.json` contiene un script `package` (`pkg .`) y la sección `pkg` incluye el asset `libs/clipboard_x86_64.exe`.
- Targets configurados: `node16-win-x64` y `node16-macos-x64`.
- Archivo principal: `script.js` (también configurado como `bin`).

## Requisitos

- Node.js (para desarrollo y empaquetado)
- `pkg` (opcional, para generar ejecutables): `npm install -g pkg`
- Dependencias (instalar con `npm install`): `firebase`, `clipboardy`, `readline-sync`

## Instalación

```powershell
npm install
```

## Empaquetado (generar binarios con `pkg`)

1. Instala `pkg` si no lo tienes:

```powershell
npm install -g pkg
```

2. Empaqueta usando el script:

```powershell
npm run package
```

El `package.json` actual incluye el asset `libs/clipboard_x86_64.exe` y targets tanto para Windows como para macOS, por lo que al empaquetar se tendrán en cuenta ambos.

### Notas específicas por plataforma

- Windows: cuando se empaqueta con `pkg`, el proyecto espera encontrar `libs/clipboard_x86_64.exe` junto al ejecutable final (por ejemplo, en `dist` o la misma carpeta que el `.exe`). `script.js` fuerza el uso de ese binario en tiempo de ejecución cuando detecta `process.pkg` y `process.platform === 'win32'`.
- macOS / Linux: `clipboardy` funciona de forma nativa y no requiere el binario externo.

## Uso

Al ejecutar el script empaquetado o en desarrollo, el programa te pedirá un `userId` (se guarda en `~/.clipboard-sync-config.json`) usado como identificador en Firestore. El proceso sincroniza el portapapeles local con el documento `clipboard/<userId>` en Firestore.

Ejemplo de ejecución en desarrollo:

```powershell
node script.js
```

Opciones:

- `--help` o `-h`: muestra ayuda básica.

## Seguridad / Privacidad

- El `script.js` contiene una configuración de Firebase con claves públicas de configuración. Estas claves permiten el acceso al proyecto Firebase configurado; revisa si debes usar tu propio proyecto o restringir el acceso.

## Estructura relevante

- `script.js` — script principal que sincroniza el portapapeles con Firestore.
- `package.json` — contiene dependencias y configuración de `pkg`.
- `libs/clipboard_x86_64.exe` — binario usado en Windows empaquetado junto al `.exe`.

## Créditos

- clipboardy
- pkg
- Firebase
