import path from 'path';
import {Tray, Menu, app} from 'electron';
import {createSettingsWindow} from './window';
import {restartSync, stopSync} from './sync';

let tray: Tray | null = null;

export function createTray(onLog: (line: string) => void): void {
  const iconPath = path.join(__dirname, '../../assets/logo.ico');
  tray = new Tray(iconPath);
  tray.setToolTip('Clipboard Sync');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir configuración',
      click: () => createSettingsWindow(onLog),
    },
    {type: 'separator'},
    {
      label: 'Reiniciar sync',
      click: () => restartSync(),
    },
    {
      label: 'Detener sync',
      click: () => stopSync(),
    },
    {type: 'separator'},
    {
      label: 'Salir',
      click: () => {
        stopSync();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => createSettingsWindow(onLog));
  tray.on('double-click', () => createSettingsWindow(onLog));

  tray.displayBalloon({
    iconType: 'none',
    title: 'Clipboard Sync',
    content: 'Ejecutándose en la bandeja del sistema.',
  });
}
