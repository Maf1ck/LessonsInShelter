const { app } = require('electron');
const path = require('path');

// У зібраному застосунку ресурси лежать поруч з exe (extraResources),
// у режимі розробки - у корені репозиторію.
const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');

module.exports = {
  webDir: path.join(root, 'web'),
  mediamtx: path.join(root, 'server', 'bin', 'mediamtx.exe'),
  ffmpeg: path.join(root, 'server', 'bin', 'ffmpeg.exe'),
  mediamtxYml: path.join(root, 'server', 'mediamtx.yml'),
  firewallScript: path.join(root, 'server', 'win', 'allow-firewall.ps1'),
  icon: path.join(__dirname, '..', 'build', 'icon.png'),
};
