const {rcedit} = require('rcedit');
rcedit('clipboard-sync-engine.exe', {icon: 'assets/logo.ico'}, (err) => {
  if (err) {
    console.error('Error al establecer icono en clipboard-sync-engine.exe:', err.message);
    process.exit(1);
  }
  console.log('Icono establecido en clipboard-sync-engine.exe');
});
